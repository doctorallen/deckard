import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { Task, WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { buildTopItems, createTopOffer, describeTopTitle, reviseTopSelection, type TopItem, writeTopTasks } from '../ui/commands/topTasks';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { buildTopRows } from '../ui/state/topTasksState';
import { useDiskWorkspace } from './diskWorkspace';

/**
 * Deckard: Pick Today's Top Tasks (docs/implementation/50-top-three.md):
 * the rows its list offers, what it refuses, and what it writes to today's
 * note and to a picked task's own note, as one change.
 */
suite('Pick Today\'s Top Tasks: its list and what it writes', () => {
  const NOTES: Record<string, string> = {
    'projects/Borealis.md': [
      '# Borealis',
      '',
      '## Vendor sync',
      '- [ ] Send the vendor quote 📅 2026-11-23',
      '- [x] Book the cold room ✅ 2026-11-24 ^cold-room',
      '- [ ] Call Ren about the depot list',
      '',
    ].join('\n'),
    'journal/2026-11-24.md': [
      '# 2026-11-24',
      '',
      '## Top three',
      '',
      '- [[Borealis#^cold-room|Book the cold room]]',
      '- [ ] Outline the Q1 staffing ask',
      '',
      '## Carried over',
      '',
      '- [ ] Reply to Dana',
      '',
    ].join('\n'),
  };
  const now = new Date(2026, 10, 24, 9).getTime();
  const index: WorkspaceIndex = buildWorkspaceIndex(
    new Map(Object.entries(NOTES).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
  const taskTitled = (title: string): Task => {
    const task = [...index.tasks.values()].find((each) => each.title.startsWith(title));
    assert.ok(task, `a task titled ${title}`);
    return task;
  };

  // In the extension host the suite runs against VS Code; under the e2e
  // stand-in, against a workspace on disk modeled on it.
  let putBack: () => void = () => undefined;
  suiteSetup(() => {
    putBack = useDiskWorkspace();
  });
  suiteTeardown(() => putBack());

  /** The notes on disk under a folder of their own, removed when `run` ends. */
  const withNotes = async (
    run: (uriOf: (filePath: string) => vscode.Uri, read: (filePath: string) => Promise<string>) => Promise<void>,
  ): Promise<void> => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-top-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    const uriOf = (filePath: string): vscode.Uri => vscode.Uri.joinPath(root, ...filePath.split('/'));
    try {
      for (const [filePath, content] of Object.entries(NOTES)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uriOf(filePath), '..'));
        await vscode.workspace.fs.writeFile(uriOf(filePath), Buffer.from(content, 'utf8'));
      }
      await run(uriOf, async (filePath) => Buffer.from(await vscode.workspace.fs.readFile(uriOf(filePath))).toString('utf8'));
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  };

  const items = (): TopItem[] => buildTopItems(buildTopRows(index, createQueryContext(now), { query: '', count: 3 }));
  const titled = (list: readonly TopItem[], label: string): TopItem => {
    const item = list.find((each) => each.label === label);
    assert.ok(item, `a row labeled ${label}`);
    return item;
  };

  test('lists today\'s picks first, then what is overdue and the rest, most urgent first, each with why and where', () => {
    assert.deepStrictEqual(
      items().map((item) => [item.label, item.description, item.row?.group]),
      [
        ['Chosen', undefined, undefined],
        ['Book the cold room', 'Done · Borealis › Vendor sync', 'chosen'],
        ['Outline the Q1 staffing ask', '2026-11-24 › Top three', 'chosen'],
        ['Overdue', undefined, undefined],
        ['Send the vendor quote', 'Overdue 1 day · Borealis › Vendor sync', 'overdue'],
        ['Most urgent', undefined, undefined],
        ['Reply to Dana', '2026-11-24 › Carried over', 'urgent'],
        ['Call Ren about the depot list', 'Borealis › Vendor sync', 'urgent'],
      ],
    );
    assert.strictEqual(describeTopTitle(3, 2), 'Today\'s top three · 2 of 3 chosen');
    assert.strictEqual(describeTopTitle(1, 0), 'Today\'s top task · 0 of 1 chosen');
  });

  test('offers what was typed as a new task only when it matches no row', () => {
    const list = items();
    assert.strictEqual(createTopOffer('vendor', list), undefined);
    assert.strictEqual(createTopOffer('  ', list), undefined);
    const offer = createTopOffer(' Draft the  staffing memo ', list);
    assert.deepStrictEqual(
      [offer?.label, offer?.newTitle, offer?.alwaysShow],
      ['$(add) Add "Draft the staffing memo" as a new task in today\'s note', 'Draft the staffing memo', true],
    );
  });

  test('refuses one more than the limit, and unchecking a pick that is done or written under the heading', () => {
    const list = items();
    const [done, written, quote, ren] = ['Book the cold room', 'Outline the Q1 staffing ask', 'Send the vendor quote', 'Call Ren about the depot list'].map((label) => titled(list, label));
    const two = [done, written];
    // A third is taken, in the order checked, whatever order the list reports.
    const three = reviseTopSelection(two, [done, written, ren], 3);
    assert.deepStrictEqual(three, { checked: [done, written, ren] });
    // A fourth is refused, in words, and the three stay.
    assert.deepStrictEqual(reviseTopSelection(three.checked, [done, written, quote, ren], 3), {
      checked: [done, written, ren],
      refused: 'Three is the limit. Uncheck one to pick "Send the vendor quote".',
    });
    // One unchecked makes room, and the next checked goes last.
    assert.deepStrictEqual(reviseTopSelection(three.checked, [done, written], 3), { checked: [done, written] });
    assert.deepStrictEqual(reviseTopSelection(two, [done, written, quote], 3).checked, [done, written, quote]);
    // A done pick stays, and so does a task written under the heading.
    assert.deepStrictEqual(reviseTopSelection(two, [written], 3), {
      checked: [done, written],
      refused: '"Book the cold room" is done today, so it stays.',
    });
    assert.deepStrictEqual(reviseTopSelection(two, [done], 3), {
      checked: [done, written],
      refused: '"Outline the Q1 staffing ask" is written under the heading, so it stays. Move or delete its line to drop it.',
    });
    // The list redrawn with the same rows checked changes nothing.
    assert.deepStrictEqual(reviseTopSelection(two, [written, done], 3), { checked: [done, written] });
  });

  test('writes the section in today\'s note and a marker in the task\'s note, as one change Undo takes back', async () => {
    await withNotes(async (uriOf, read) => {
      const history = new WorkspaceWriteHistory();
      const written = await writeTopTasks(history, {
        index,
        todayUri: uriOf('journal/2026-11-24.md'),
        todayPath: 'journal/2026-11-24.md',
        count: 3,
        choices: [{ task: taskTitled('Send the vendor quote') }, { task: taskTitled('Outline the Q1 staffing ask') }, { title: 'Draft the staffing memo' }],
        uriOf: async (filePath) => uriOf(filePath),
      });
      assert.strictEqual(written.kind, 'written');
      assert.strictEqual(
        await read('journal/2026-11-24.md'),
        [
          '# 2026-11-24',
          '',
          '## Top three',
          '',
          '- [[Borealis#^send-the-vendor|Send the vendor quote]]',
          '- [ ] Outline the Q1 staffing ask',
          '- [ ] Draft the staffing memo',
          '',
          '## Carried over',
          '',
          '- [ ] Reply to Dana',
          '',
        ].join('\n'),
      );
      assert.ok((await read('projects/Borealis.md')).includes('- [ ] Send the vendor quote 📅 2026-11-23 ^send-the-vendor\n'), 'the marker ends the task\'s line');

      assert.ok(await history.undo(), 'one Undo takes back both notes');
      assert.strictEqual(await read('journal/2026-11-24.md'), NOTES['journal/2026-11-24.md']);
      assert.strictEqual(await read('projects/Borealis.md'), NOTES['projects/Borealis.md']);
    });
  });

  /** Writes `choices` as today's picks, in a history of its own. */
  const write = (uriOf: (filePath: string) => vscode.Uri, choices: Parameters<typeof writeTopTasks>[1]['choices']) =>
    writeTopTasks(new WorkspaceWriteHistory(), {
      index,
      todayUri: uriOf('journal/2026-11-24.md'),
      todayPath: 'journal/2026-11-24.md',
      count: 3,
      choices,
      uriOf: async (filePath) => uriOf(filePath),
    });

  test('writes nothing when the picks are the ones written', async () => {
    await withNotes(async (uriOf, read) => {
      assert.deepStrictEqual(
        await write(uriOf, [{ task: taskTitled('Book the cold room') }, { task: taskTitled('Outline the Q1 staffing ask') }]),
        { kind: 'unchanged' },
      );
      assert.strictEqual(await read('journal/2026-11-24.md'), NOTES['journal/2026-11-24.md']);
    });
  });

  test('writes nothing when a picked line has changed since it was listed', async () => {
    await withNotes(async (uriOf, read) => {
      // Changed before the note is opened, as a note edited since the index read it is.
      await vscode.workspace.fs.writeFile(uriOf('projects/Borealis.md'), Buffer.from(NOTES['projects/Borealis.md'].replace('Send the vendor quote', 'Send the revised quote'), 'utf8'));
      assert.deepStrictEqual(await write(uriOf, [{ task: taskTitled('Send the vendor quote') }]), {
        kind: 'refused',
        reason: '"Send the vendor quote" has changed since it was listed, so nothing was written.',
      });
      assert.strictEqual(await read('journal/2026-11-24.md'), NOTES['journal/2026-11-24.md']);
    });
  });
});
