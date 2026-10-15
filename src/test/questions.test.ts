import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  getQuestions,
  isAnswered,
  listOpenQuestions,
  listQuestionsMentioning,
  questionText,
  readQuestionTagKeys,
} from '../domain/index/questions';
import { findQuestionSymbol, readTaskStatuses, statusForSymbol, DEFAULT_TASK_STATUSES } from '../domain/tasks/taskStatuses';
import type { ParsedFile } from '../domain/model';
import { parseQuery } from '../domain/query/queryParser';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { createQueryContext } from '../domain/query/queryContext';
import { createQueryBlockSnapshot, describeQueryBlockCounts, parseQueryBlockInfo } from '../ui/state/queryBlockState';
import { renderQueryBlockHtml } from '../ui/preview/queryBlockHtml';
import { findAnswerOffers, notItKey } from '../domain/ranking/answerOffers';
import { hashLine } from '../domain/ranking/lineIndex';
import { indexOf as typedIndexOf, typedWorkspace } from './typedWorkspace';

/** An index of notes, by path and text, each dated by its own name when it is a day. */
function indexOf(notes: Record<string, string>): ReturnType<typeof buildWorkspaceIndex> {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, text]): [string, ParsedFile] => [filePath, parseMarkdown(filePath, text)])),
  );
}

suite('Questions: reading a note', () => {
  test('a [?] line is a question, not a task, with its own tags and its heading\'s', () => {
    const file = parseMarkdown('notes/rates.md', [
      '# Rates #team/rates',
      '- [?] Who approves access to the bond UAT? @priya',
      '- [ ] Book the room',
    ].join('\n'));
    assert.deepStrictEqual(file.tasks.map((task) => task.title), ['Book the room']);
    const [question] = file.questions ?? [];
    assert.strictEqual(question.title, 'Who approves access to the bond UAT? @priya');
    assert.strictEqual(question.lineNumber, 2);
    assert.strictEqual(question.symbol, '?');
    assert.deepStrictEqual(question.tags, ['#team/rates', '@priya']);
    assert.deepStrictEqual(question.associationTagGroups, [[{ key: '@priya', label: '@priya' }]]);
    assert.match(question.id, /^question-/);
    assert.strictEqual(isAnswered(question), false);
  });

  test('is answered by an indented line under it that starts with Answer:, in any case', () => {
    const [first, second, third] = parseMarkdown('notes/q.md', [
      '- [?] Who approves access?',
      '    - ANSWER: Priya, via the RATES-UAT group (2026-10-14)',
      '- [?] Where is the runbook?',
      '  some words first',
      '  Answer: in the wiki',
      '- [?] Still open?',
      '- Answer: not under it',
    ].join('\n')).questions ?? [];
    assert.deepStrictEqual(first.answer?.text, 'Priya, via the RATES-UAT group (2026-10-14)');
    assert.strictEqual(first.answer?.lineNumber, 2);
    assert.strictEqual(new Date(first.answer?.answeredAt ?? 0).getDate(), 14);
    assert.deepStrictEqual(second.answer, { text: 'in the wiki', lineNumber: 5 });
    assert.strictEqual(third.answer, undefined, 'a line not indented under it answers nothing');
  });

  test('a question line starts no tagged entry, and a fenced one is no question', () => {
    const file = parseMarkdown('notes/q.md', ['- [?] Who leads #team/fx?', '```', '- [?] An example', '```'].join('\n'));
    assert.strictEqual(file.questions?.length, 1);
    assert.ok(!file.sections.some((section) => section.isInline), 'no entry of its own');
  });

  test('`?` is Question unless the list gives it to a status of its own, which turns questions off', () => {
    assert.deepStrictEqual(statusForSymbol(DEFAULT_TASK_STATUSES, '?'), { symbol: '?', name: 'Question', type: 'question' });
    assert.strictEqual(findQuestionSymbol(readTaskStatuses([{ symbol: '/', name: 'Doing', type: 'inProgress' }])), '?');
    const theirs = readTaskStatuses([{ symbol: '?', name: 'Maybe', type: 'todo' }]);
    assert.strictEqual(findQuestionSymbol(theirs), undefined);
    const file = parseMarkdown('note.md', '- [?] Ask about swag\n', undefined, { taskStatuses: theirs });
    assert.deepStrictEqual([file.tasks.length, file.questions], [1, undefined]);
  });
});

suite('Questions: across the workspace', () => {
  const index = indexOf({
    'notes/2026-10-01.md': '# 2026-10-01\n- [?] Who approves access? @priya #team/rates\n',
    'notes/2026-09-20.md': '# 2026-09-20\n## Desk #team/rates\n- [?] Where is the curve loader? #infra\n  - Answer: on the grid box\n- [?] Why did the feed lag?\n',
  });

  test('lists the open ones, oldest first, and is not a task anywhere', () => {
    assert.strictEqual(getQuestions(index).size, 3);
    assert.deepStrictEqual(listOpenQuestions(index).map(questionText), ['Why did the feed lag?', 'Who approves access?']);
    assert.strictEqual(index.tasks.size, 0);
  });

  test('lists the open questions that name a person', () => {
    assert.deepStrictEqual(listQuestionsMentioning(index, '@priya').map(questionText), ['Who approves access?']);
    assert.deepStrictEqual(listQuestionsMentioning(index, '#team/rates'), [], 'a tag that is not a person');
  });

  test('a question carries its heading\'s tags for a tag search', () => {
    const lag = [...getQuestions(index).values()].find((question) => question.title.startsWith('Why'));
    assert.ok(lag && readQuestionTagKeys(index, lag).has('#team/rates'));
  });
});

suite('Questions: searching', () => {
  const index = indexOf({
    'notes/2026-10-01.md': [
      '# 2026-10-01',
      '## Desk #team/rates',
      '- [?] Who approves access to the bond UAT?',
      '  - Answer: Priya',
      '- [?] Why did the feed lag?',
      '- [ ] Book the room',
      'A plain line about the feed.',
    ].join('\n'),
  });
  const find = (query: string) => {
    const parsed = parseQuery(query);
    assert.deepStrictEqual(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [], query);
    const results = evaluateQuery(index, parsed.node, createQueryContext(Date.now()));
    return {
      questions: results.questions.map(questionText),
      tasks: results.tasks.length,
      notes: results.sections.length + results.files.length,
    };
  };

  test('is:question, is:answered, and is:unanswered find questions and nothing else', () => {
    assert.deepStrictEqual(find('is:question'), { questions: ['Who approves access to the bond UAT?', 'Why did the feed lag?'], tasks: 0, notes: 0 });
    assert.deepStrictEqual(find('is:answered').questions, ['Who approves access to the bond UAT?']);
    assert.deepStrictEqual(find('is:unanswered').questions, ['Why did the feed lag?']);
  });

  test('a question is neither a task nor a note, and a tag or a word finds it', () => {
    assert.deepStrictEqual(find('is:open').questions, []);
    assert.strictEqual(find('is:open').tasks, 1);
    assert.deepStrictEqual(find('is:note').questions, []);
    assert.deepStrictEqual(find('#team/rates is:unanswered').questions, ['Why did the feed lag?']);
    assert.deepStrictEqual(find('text ~ priya').questions, ['Who approves access to the bond UAT?'], 'its answer\'s words count');
    assert.deepStrictEqual(find('-is:question #team/rates').questions, []);
  });

  test('a query block and the assistant list the questions it finds', () => {
    const options = parseQueryBlockInfo('deckard') as NonNullable<ReturnType<typeof parseQueryBlockInfo>>;
    const snapshot = createQueryBlockSnapshot(index, 'is:question', options, { queryContext: createQueryContext(Date.now()) });
    assert.deepStrictEqual(snapshot.questions.map((item) => [item.title, item.answered, item.answer]), [
      ['Who approves access to the bond UAT?', true, 'Priya'],
      ['Why did the feed lag?', false, undefined],
    ]);
    assert.strictEqual(snapshot.questionCount, 2);
    assert.strictEqual(describeQueryBlockCounts(snapshot), '2 questions');
    const html = renderQueryBlockHtml('is:question', options, index, { queryContext: createQueryContext(Date.now()) });
    assert.match(html, /deckard-query-questions/);
    assert.match(html, /Answer: Priya/);
  });
});

suite('Questions: offering an answer', () => {
  const notes = {
    'notes/2026-10-01.md': [
      '# 2026-10-01',
      '- [?] Who approves access to the bond UAT environment? #team/rates',
      '- [?] Why did the curve loader lag on Monday?',
    ].join('\n'),
    'notes/2026-10-14.md': [
      '# 2026-10-14',
      '## Access #team/rates',
      '- Priya approves bond UAT environment access through the RATES-UAT group',
      '- The curve loader lag came from a stale cache on Monday',
    ].join('\n'),
    'notes/2026-09-01.md': '# 2026-09-01\n- Bond UAT environment access was being set up then\n',
    'notes/2026-10-15.md': '# 2026-10-15\n- Bond UAT environment access, untagged, written later\n',
  };
  const offersOf = (rejected: ReadonlySet<string> = new Set()) => {
    const index = indexOf(notes);
    const offers = findAnswerOffers(index, { rejected });
    return { index, offers: [...offers.values()].map((offer) => [questionText(getQuestions(index).get(offer.questionId)!), offer.text]) };
  };

  test('offers a later line sharing three uncommon words, and a tag when the question has one', () => {
    assert.deepStrictEqual(offersOf().offers, [
      ['Who approves access to the bond UAT environment?', 'Priya approves bond UAT environment access through the RATES-UAT group'],
      ['Why did the curve loader lag on Monday?', 'The curve loader lag came from a stale cache on Monday'],
    ]);
  });

  test('never offers a line written before the question, or one without its tag', () => {
    const { offers } = offersOf();
    assert.ok(!offers.some(([, text]) => text.includes('set up then') || text.includes('untagged')));
  });

  test('Not it sets a pair aside, and the next best is offered, or none', () => {
    const { index } = offersOf();
    const first = [...findAnswerOffers(index, { rejected: new Set() }).values()];
    const rejected = new Set(first.map((offer) => notItKey(offer.questionId, offer.key)));
    assert.deepStrictEqual([...findAnswerOffers(index, { rejected }).values()], []);
    assert.strictEqual(hashLine('- Priya approves'), hashLine('* Priya   approves'), 'a pair is kept by the line\'s words');
  });

  test('a line sharing two words is not offered', () => {
    const index = indexOf({
      'notes/2026-10-01.md': '# 2026-10-01\n- [?] Why did the curve loader lag?\n',
      'notes/2026-10-02.md': '# 2026-10-02\n- The curve was flat\n- The loader lag again\n',
    });
    assert.strictEqual(findAnswerOffers(index, { rejected: new Set() }).size, 0);
  });
});

suite('Questions: answered by a typed row\'s field', () => {
  test('a question naming a row and a field is offered the field\'s value, from the note that holds it', () => {
    const base = typedWorkspace();
    const notes = Object.fromEntries(
      [...base.files.values(), ...(base.typeNotes?.values() ?? [])].map((file) => [file.filePath, file.content]),
    );
    const index = typedIndexOf({ ...notes, 'notes/asks.md': '# Asks\n- [?] Who leads rates?\n' });
    const [offer] = [...findAnswerOffers(index, { rejected: new Set() }).values()];
    assert.deepStrictEqual([offer.kind, offer.text, offer.source, offer.filePath], ['field', 'Dana Whitfield', 'lead of Rates', 'Teams/Rates.md']);
  });
});
