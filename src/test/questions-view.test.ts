import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { QuestionMemory } from '../core/storage/questionMemory';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { getQuestions } from '../domain/index/questions';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { createVscodeEditApplier, createVscodeHistoryWriter } from '../platform/vscodeEditApplier';
import { createVscodeWorkspace } from '../platform/vscodeWorkspace';
import { QuestionService } from '../services/questionService';
import { resolveSourceUri } from '../ui/commands/navigation';
import { dropQuestion, rejectOffer, useOffer, type QuestionWrites } from '../ui/commands/questionActions';
import { WorkspaceWriteHistory, type WriteHandle } from '../ui/commands/workspaceWrites';
import { QuestionsTreeProvider, type QuestionsNode } from '../ui/views/questionsTree';
import { formatIsoDate } from '../domain/markdown/calendar';
import { EditorLenses } from '../ui/providers/editorLenses';
import { buildQuickFindResults } from '../ui/state/quickFindState';
import { describeMisses, toPickItems } from '../ui/commands/quickFind';
import { createQueryContext } from '../domain/query/queryContext';
import { formatQuestionLine } from '../domain/markdown/questionLines';
import { createPreferences, MemoryStore } from './preferenceServices';
import { listGoToItems } from '../ui/views/pagesTree';
import { answerQuestion } from '../ui/commands/assistantWrites';

/** A key-value store in memory, as the workspace's state is. */
function memoryStore(): ConstructorParameters<typeof QuestionMemory>[0] {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback?: T) => (values.has(key) ? (values.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

/** Notes written to a folder of their own, and indexed by their full paths, as the suites' writes find them. */
async function writeNotes(notes: Record<string, string>): Promise<{ index: () => Promise<WorkspaceIndex>; uris: Record<string, vscode.Uri> }> {
  const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-questions-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  await vscode.workspace.fs.createDirectory(root);
  const uris: Record<string, vscode.Uri> = {};
  for (const [name, text] of Object.entries(notes)) {
    uris[name] = vscode.Uri.joinPath(root, name);
    await vscode.workspace.fs.writeFile(uris[name], Buffer.from(text, 'utf8'));
  }
  const index = async () =>
    buildWorkspaceIndex(
      new Map(
        await Promise.all(
          Object.entries(uris).map(async ([, uri]) => {
            const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            return [uri.fsPath, parseMarkdown(uri.fsPath, text)] as const;
          }),
        ),
      ),
    );
  return { index, uris };
}

/** Question writes over VS Code's editor and a history of the suite's own. */
function createQuestionWrites(memory = new QuestionMemory(memoryStore())): QuestionWrites {
  return {
    questions: new QuestionService<vscode.Uri, WriteHandle>({
      notes: createVscodeEditApplier(),
      history: createVscodeHistoryWriter(new WorkspaceWriteHistory('never')),
      resolveUri: (filePath) => resolveSourceUri(filePath),
      configuration: createVscodeWorkspace(),
      clock: { now: () => Date.now() },
    }),
    memory,
  };
}

/** The note's text once it reads as `expected`, or as it last read after five seconds. */
async function noteReads(uri: vscode.Uri, expected: (text: string) => boolean): Promise<string> {
  const until = Date.now() + 5000;
  let text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  while (!expected(text) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  }
  return text;
}

suite('The Questions view', () => {
  const notes = {
    '2026-10-01.md': '# 2026-10-01\n- [?] Who approves access to the bond UAT environment? #team/rates\n- [?] Where does the runbook live?\n  - Answer: in the wiki\n',
    '2026-10-14.md': '# 2026-10-14\n## Access #team/rates\n- Priya approves bond UAT environment access via RATES-UAT\n',
  };

  /** A view over an index that never changes, with the memory given. */
  function viewOf(index: WorkspaceIndex, memory: QuestionMemory): QuestionsTreeProvider {
    return new QuestionsTreeProvider(
      { getSnapshot: () => index, getUri: (filePath) => vscode.Uri.file(filePath), onDidUpdate: () => ({ dispose: () => undefined }) },
      memory,
    );
  }

  test('lists each open question with its age and tag, and under it the answer offered, with Use as answer and Not it', async () => {
    const { index } = await writeNotes(notes);
    const built = await index();
    const provider = viewOf(built, new QuestionMemory(memoryStore()));
    try {
      const rows = provider.getChildren();
      assert.deepStrictEqual(rows.map((node) => provider.getTreeItem(node).label), ['Who approves access to the bond UAT environment?']);
      const item = provider.getTreeItem(rows[0]);
      assert.match(String(item.description), /^open \d+ days · #team\/rates$/);
      assert.strictEqual(item.contextValue, 'deckardQuestion');
      assert.strictEqual(item.command?.command, 'vscode.open');
      const [offer] = provider.getChildren(rows[0]);
      const offerItem = provider.getTreeItem(offer);
      assert.match(String(offerItem.label), /^May answer: .+ · Access$/);
      assert.strictEqual(offerItem.description, 'Priya approves bond UAT environment access via RATES-UAT');
      assert.strictEqual(offerItem.contextValue, 'deckardQuestionOffer');
      provider.setShowAnswered(true);
      assert.deepStrictEqual(
        provider.getChildren().map((node) => [provider.getTreeItem(node).label, provider.getTreeItem(node).contextValue]),
        [
          ['Who approves access to the bond UAT environment?', 'deckardQuestion'],
          ['Where does the runbook live?', 'deckardAnsweredQuestion'],
        ],
      );
    } finally {
      provider.dispose();
    }
  });

  test('Not it sets the offer aside, and the row has none', async () => {
    const { index } = await writeNotes(notes);
    const built = await index();
    const memory = new QuestionMemory(memoryStore());
    const provider = viewOf(built, memory);
    try {
      const [question] = provider.getChildren();
      const [offer] = provider.getChildren(question) as Array<Extract<QuestionsNode, { kind: 'offer' }>>;
      await rejectOffer({ ready: Promise.resolve(), getSnapshot: () => built }, createQuestionWrites(memory), { questionId: offer.questionId, offer: offer.offer });
      assert.deepStrictEqual(provider.getChildren(provider.getChildren()[0]), []);
    } finally {
      provider.dispose();
    }
  });

  test('Use as answer writes the line\'s words and a link to it under the question, and Drop writes [-]', async () => {
    const { index, uris } = await writeNotes(notes);
    const built = await index();
    const writes = createQuestionWrites();
    const source = { ready: Promise.resolve(), getSnapshot: () => built };
    const [open] = [...getQuestions(built).values()];
    assert.strictEqual(await useOffer(source, writes, open.id), true);
    const today = formatIsoDate(Date.now());
    const answered = await noteReads(uris['2026-10-01.md'], (text) => text.includes('Answer: Priya'));
    assert.strictEqual(
      answered.split('\n')[2],
      `  - Answer: Priya approves bond UAT environment access via RATES-UAT [[2026-10-14#Access]] (${today})`,
    );
    const reread = await index();
    const runbook = [...getQuestions(reread).values()].find((question) => question.title.startsWith('Where'));
    assert.ok(runbook);
    assert.strictEqual(await dropQuestion({ ready: Promise.resolve(), getSnapshot: () => reread }, writes, runbook.id), true);
    const dropped = await noteReads(uris['2026-10-01.md'], (text) => text.includes('- [-] Where'));
    assert.match(dropped, /- \[-\] Where does the runbook live\? ❌ \d{4}-\d{2}-\d{2}/);
  });

  test('writes nothing to a question whose line changed since it was read', async () => {
    const { index, uris } = await writeNotes(notes);
    const built = await index();
    await vscode.workspace.fs.writeFile(uris['2026-10-01.md'], Buffer.from('# 2026-10-01\n- [?] Who approves access, reworded?\n', 'utf8'));
    const [open] = [...getQuestions(built).values()];
    const result = await createQuestionWrites().questions.answer(open, { text: 'Priya' });
    assert.strictEqual(result.kind, 'stale');
  });
});

suite('The lens above a question', () => {
  test('says how long it has been open and the line that may answer it, with Answer… and Drop; an answered one says when', async () => {
    const { index, uris } = await writeNotes({
      '2026-10-01.md': '# 2026-10-01\n- [?] Who approves access to the bond UAT environment?\n- [?] Where does the runbook live?\n  - Answer: in the wiki (2026-10-09)\n',
      '2026-10-14.md': '# 2026-10-14\n## Access\n- Priya approves bond UAT environment access via RATES-UAT\n',
    });
    const built = await index();
    const lenses = new EditorLenses(
      {
        ready: Promise.resolve(),
        onDidUpdate: () => ({ dispose: () => undefined }),
        getSnapshot: () => built,
        getFilePath: (uri) => uri.fsPath,
        isNotesFile: () => true,
        parse: (uri, content) => parseMarkdown(uri.fsPath, content),
      },
      new QuestionMemory(memoryStore()),
    ).register();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const document = await vscode.workspace.openTextDocument(uris['2026-10-01.md']);
      // The daily note's own lenses, on its first line, are another group's.
      const provided = lenses.provideCodeLenses(document).filter((lens) => lens.range.start.line > 0);
      const resolved = await Promise.all(provided.map((lens) => lenses.resolveCodeLens(lens)));
      const said = resolved.map((lens) => `${lens.range.start.line}: ${lens.command?.title ?? ''}`);
      assert.strictEqual(said.length, 5);
      assert.match(said[0], /^1: Question · open \d+ days$/);
      assert.match(said[1], /^1: 1 line may answer it: .+ · Access$/);
      assert.deepStrictEqual(said.slice(2), ['1: Answer…', '1: Drop', '2: Question · answered Fri, Oct 9']);
      assert.strictEqual(resolved[2].command?.command, 'deckard.questions.answer');
      assert.strictEqual(resolved[3].command?.command, 'deckard.questions.drop');
    } finally {
      lenses.dispose();
    }
  });
});

suite('Find and questions', () => {
  const index = buildWorkspaceIndex(
    new Map(
      Object.entries({
        'notes/2026-10-01.md': '# 2026-10-01\n- [?] Who approves access to the bond UAT? #team/rates\n',
        'notes/rates.md': '# Rates desk\nThe curve loader restarts at six.\n',
      }).map(([filePath, text]) => [filePath, parseMarkdown(filePath, text)] as const),
    ),
  );
  const find = (input: string) =>
    buildQuickFindResults({
      index,
      preferences: createPreferences(new MemoryStore()).reader.value,
      input,
      searchText: () => ({ matches: [], partial: false }),
      queryContext: createQueryContext(Date.now()),
      formatQuestion: (text) => formatQuestionLine(text),
    });

  test('lists the open questions that match, with a ? icon', () => {
    const results = find('bond uat');
    assert.deepStrictEqual(results.questions?.map((row) => [row.kind, row.label, row.line]), [['question', 'Who approves access to the bond UAT?', 2]]);
    const rows = toPickItems(results, 'bond uat');
    assert.ok(rows.some((row) => row.label === '$(question) Who approves access to the bond UAT?'));
  });

  test('offers Ask it first when nothing has every word, saying how often it was searched for', async () => {
    const results = find('who signs the vendor lease');
    assert.deepStrictEqual(results.ask, {
      words: 'who signs the vendor lease',
      question: 'Who signs the vendor lease?',
      line: '- [?] Who signs the vendor lease?',
    });
    const memory = new QuestionMemory(memoryStore());
    const first = new Date(2026, 9, 2, 9).getTime();
    await memory.recordMiss('Who signs the  vendor lease', first);
    await memory.recordMiss('who signs the vendor lease', first + 1000);
    const said = describeMisses(memory.missed('who signs the vendor lease'), createQueryContext(new Date(2026, 9, 14).getTime()));
    assert.strictEqual(said, 'You have searched for this 3 times since Fri, Oct 2');
    const [ask] = toPickItems(results, 'who signs the vendor lease', undefined, said);
    assert.strictEqual(ask.label, '$(question) Ask it: add “Who signs the vendor lease?” to today’s note');
    assert.strictEqual(ask.description, said);
    assert.strictEqual(find('rates').ask, undefined, 'a search that found something asks nothing');
  });
});

suite('Go to… and questions', () => {
  test('lists Open questions after the pages, which opens the search for is:unanswered', () => {
    const built = buildWorkspaceIndex(new Map([['notes/q.md', parseMarkdown('notes/q.md', '# Q\n- [?] Who approves access?\n- [?] Where is it?\n  - Answer: here\n')]]));
    const items = listGoToItems({ getSnapshot: () => built }, vscode.Uri.file(path.join(__dirname, '..', '..')));
    const last = items[items.length - 1];
    assert.deepStrictEqual([last.label, last.description, last.command, last.args], ['Open questions', '1 open', 'deckard.searchNotes', ['is:unanswered']]);
    assert.strictEqual(items[0].label, 'Home', 'the pages come first');
  });
});

suite('The assistant answers a question', () => {
  const built = buildWorkspaceIndex(new Map([['notes/q.md', parseMarkdown('notes/q.md', '# Q\n- [?] Who approves access?\n')]]));
  const source = { ready: Promise.resolve(), getSnapshot: () => built };

  test('writes through the question service, shown in the preview, and says so', async () => {
    const asked: unknown[] = [];
    const answer = await answerQuestion(source, {
      answer: async (question, words, shown) => {
        asked.push([question.lineNumber, words, shown?.preview]);
        return { kind: 'written', handle: undefined };
      },
    }, { note: 'notes/q.md', line: 2, answer: 'Priya' });
    assert.deepStrictEqual(asked, [[2, { text: 'Priya' }, 'always']]);
    assert.match(answer.text, /^Wrote the answer under the question at notes\/q\.md line 2/);
  });

  test('refuses a line no question is on, and says when the reader declined', async () => {
    const declined = { answer: async () => ({ kind: 'rejected' as const, uri: vscode.Uri.file('/q.md') }) };
    assert.strictEqual((await answerQuestion(source, declined, { note: 'notes/q.md', line: 1, answer: 'x' })).isError, true);
    assert.match((await answerQuestion(source, declined, { note: 'notes/q.md', line: 2, answer: 'x' })).text, /declined/);
  });
});
