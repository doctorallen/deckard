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
import { indexKeyOf } from './indexKeys';
import { buildQuickFindResults } from '../ui/state/quickFindState';
import { describeMisses, findDailyNoteRow, QuickFind, toPickItems } from '../ui/commands/quickFind';
import { createTaskWrites } from './taskWrites';
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
            return [indexKeyOf(uri), parseMarkdown(indexKeyOf(uri), text)] as const;
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

  test('lists each open question with its age, and under it the answer offered, with Use as answer and Not it', async () => {
    const { index } = await writeNotes(notes);
    const built = await index();
    const provider = viewOf(built, new QuestionMemory(memoryStore()));
    try {
      const rows = provider.getChildren();
      assert.deepStrictEqual(rows.map((node) => provider.getTreeItem(node).label), ['Who approves access to the bond UAT environment? #team/rates']);
      const item = provider.getTreeItem(rows[0]);
      // Its only tag is on its own line, so its label shows it, not its age.
      assert.match(String(item.description), /^open \d+ days$/);
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
          ['Who approves access to the bond UAT environment? #team/rates', 'deckardQuestion'],
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
        getFilePath: (uri) => indexKeyOf(uri),
        isNotesFile: () => true,
        parse: (uri, content) => parseMarkdown(indexKeyOf(uri), content),
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
    assert.deepStrictEqual(results.questions?.map((row) => [row.kind, row.label, row.line]), [['question', 'Who approves access to the bond UAT? #team/rates', 2]]);
    const rows = toPickItems(results, 'bond uat');
    assert.ok(rows.some((row) => row.label === '$(question) Who approves access to the bond UAT? #team/rates'));
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
    assert.strictEqual(ask.label, '$(question) Ask it in today’s note');
    assert.strictEqual(ask.detail, '- [?] Who signs the vendor lease?');
    assert.strictEqual(ask.description, said);
    assert.strictEqual(find('rates').ask, undefined, 'a search that found something asks nothing');
    // A search's words are the reader's, and no property every object has.
    assert.strictEqual(memory.missed('constructor'), undefined);
    assert.strictEqual(memory.missed('__proto__'), undefined);
    await memory.recordMiss('__proto__', first);
    await memory.recordMiss('constructor', first);
    assert.strictEqual(memory.missed('__proto__')?.count, 1);
    assert.strictEqual(memory.missed('constructor')?.count, 1);
    assert.strictEqual(Object.getPrototypeOf({}), Object.prototype);
    await memory.forgetMisses('__proto__');
    assert.strictEqual(memory.missed('__proto__'), undefined);
    assert.strictEqual(memory.missed('constructor')?.count, 1);
  });
});

suite('Find: Ask it beside a day and beside results with some of the words', () => {
  const index = buildWorkspaceIndex(
    new Map([['n.md', parseMarkdown('n.md', '# N\n- curve loader restarted after the feed lagged\n')]]),
  );
  const now = new Date(2026, 9, 14, 12).getTime();
  const rows = (input: string, partial = false) => {
    const results = buildQuickFindResults({
      index,
      preferences: createPreferences(new MemoryStore()).reader.value,
      input,
      searchText: () => ({
        matches: partial ? [{ kind: 'section' as const, id: [...index.sections.keys()][0], filePath: 'n.md', line: 1, score: 1, excerpt: 'curve loader' }] : [],
        partial,
      }),
      queryContext: createQueryContext(now),
      formatCapture: (text) => `- [ ] ${text}`,
      formatQuestion: (text) => formatQuestionLine(text),
    });
    return toPickItems(results, input, findDailyNoteRow(input, now));
  };

  test('a day typed opens its note first, and Ask it is not offered', () => {
    const items = rows('tomorrow');
    assert.ok(items[0].openDate, `the first row is ${items[0].label}`);
    assert.ok(!items.some((item) => item.ask), 'no row writes "- [?] Tomorrow?"');
  });

  test('with results that have some of the words, Ask it follows the line saying so, and leaves the words out of its label', () => {
    const items = rows('curve zebra', true);
    assert.deepStrictEqual(items.slice(0, 2).map((item) => item.label), [
      '$(info) No entry has every word, so these have some of them.',
      '$(question) Ask it in today’s note',
    ]);
    // VS Code lifts a row whose label matches what is typed above the rest.
    assert.ok(!items.some((item) => item.label.toLowerCase().includes('curve')), 'no row\'s label holds the words');
    assert.strictEqual(items[1].detail, '- [?] Curve zebra?');
    const at = (found: (item: (typeof items)[number]) => unknown) => items.findIndex(found);
    const note = at((item) => item.item?.kind === 'note');
    assert.ok(note > 1 && at((item) => item.create) > note && at((item) => item.capture) > note, 'Create note and Add follow the results');
    assert.deepStrictEqual(
      [items[at((item) => item.create)].description, items[at((item) => item.capture)].detail],
      ['“curve zebra”', '- [ ] curve zebra'],
    );
  });

  test('with nothing found, Ask it, Create note, and Add come first', () => {
    const items = rows('zebra crossing');
    assert.deepStrictEqual(items.slice(0, 3).map((item) => item.label), [
      '$(question) Ask it in today’s note',
      '$(new-file) Create note',
      '$(inbox) Add to today’s note',
    ]);
  });
});

suite('Find counts a missed search', () => {
  /** Find over one note on disk, whose search finds only some of the words, counting misses into `recorded`. */
  async function openFind(recorded: string[]) {
    const { uris } = await writeNotes({ 'rates.md': '# Rates\n- curve loader restarted after the feed lagged\n' });
    const filePath = indexKeyOf(uris['rates.md']);
    const built = buildWorkspaceIndex(new Map([[filePath, parseMarkdown(filePath, '# Rates\n- curve loader restarted after the feed lagged\n')]]));
    const store = createPreferences(new MemoryStore());
    const find = new QuickFind({
      indexer: {
        hasIndexed: true,
        onDidUpdate: new vscode.EventEmitter<void>().event,
        getSnapshot: () => built,
        searchEntries: () => ({
          matches: [{ kind: 'section' as const, id: [...built.sections.keys()][0], filePath, line: 2, score: 1, excerpt: 'curve loader' }],
          partial: true,
        }),
      } as never,
      preferences: store,
      actions: { openTag: async () => undefined, openSavedFilter: async () => undefined, showSearch: async () => undefined },
      writes: createTaskWrites(),
      questions: {
        missed: () => undefined,
        recordMiss: async (words: string) => {
          recorded.push(words);
          return { count: 1, first: 0, last: 0 };
        },
        forgetMisses: async () => undefined,
      },
    });
    await find.show('curve zebra');
    const shown = find as unknown as { picker?: vscode.QuickPick<vscode.QuickPickItem & { item?: { kind: string } }> };
    const picker = shown.picker;
    assert.ok(picker);
    // Find disposes its picker once it hides, which its own listener does
    // first, so a listener of the test's would never hear it.
    const hidden = (async () => {
      const until = Date.now() + 5000;
      while (shown.picker && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })();
    return { find, picker, hidden, store };
  }

  test('leaving Find without opening anything counts the search as missed', async () => {
    const recorded: string[] = [];
    const { find, picker, hidden, store } = await openFind(recorded);
    try {
      picker.hide();
      await hidden;
      assert.deepStrictEqual(recorded, ['curve zebra']);
    } finally {
      find.dispose();
      store.repository.dispose();
    }
  });

  test('opening a result that has some of the words counts no miss', async () => {
    const recorded: string[] = [];
    const { find, picker, hidden, store } = await openFind(recorded);
    try {
      const note = picker.items.find((row) => row.item?.kind === 'note');
      assert.ok(note, 'the note with some of the words is listed');
      picker.activeItems = [note];
      await (find as unknown as { accept(): Promise<void> }).accept();
      await hidden;
      assert.deepStrictEqual(recorded, []);
    } finally {
      find.dispose();
      store.repository.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
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
