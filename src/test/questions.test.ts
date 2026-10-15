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
