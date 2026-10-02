import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { applyRollover, describeRollover, getRolloverLookbackDays, placeCarriedOver } from '../ui/commands/rollover';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { planRollover } from '../domain/notes/rolloverPlan';
import { markMigrated } from '../domain/markdown/taskLineEdits';
import { WorkspaceIndex } from '../domain/model';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

const yesterday = [
  '# 2026-09-18',
  '',
  '- [x] Filed the report',
  '- [ ] Chase the contractor 📅 2026-09-19 @dana',
  '  - [ ] Get the survey back',
  '',
  '## Notes',
  '',
  'It rained.',
  '',
].join('\n');

suite('Task rollover', () => {
  // Each test writes to a history of its own, so one test's Undo never
  // reaches another's write.
  let history: WorkspaceWriteHistory;
  setup(() => {
    history = new WorkspaceWriteHistory();
  });

  test('carries what is open in every earlier daily note, oldest first', () => {
    const plan = planRollover(
      indexOf({
        'notes/2026-09-18.md': yesterday,
        'notes/2026-09-11.md': '# 2026-09-11\n\n- [ ] Left open a week ago\n',
        'notes/2026-09-17.md': '# 2026-09-17\n\n- [x] Finished that day\n',
        'notes/Atlas.md': '# Atlas\n\n- [ ] Not a daily note\n',
      }),
      '2026-09-19',
    );
    assert.deepStrictEqual(plan?.fromDates, ['2026-09-11', '2026-09-18']);
    assert.deepStrictEqual(
      plan?.tasks.map((task) => task.sourceLineText),
      [
        '- [ ] Left open a week ago',
        '- [ ] Chase the contractor 📅 2026-09-19 @dana',
        '  - [ ] Get the survey back',
      ],
      'the oldest note first, and each note in the order it writes them',
    );
  });

  test('a task left open on Friday comes forward on Monday', () => {
    const plan = planRollover(
      indexOf({
        'notes/2026-09-18.md': '# 2026-09-18\n\n- [ ] Chase the contractor\n',
      }),
      '2026-09-21',
    );
    assert.deepStrictEqual(plan?.fromDates, ['2026-09-18']);
    assert.strictEqual(plan?.tasks.length, 1);
  });

  test('looks back a week unless told otherwise', () => {
    assert.strictEqual(getRolloverLookbackDays(), 7);
  });

  test('looks back only as far as it is asked to', () => {
    const notes = indexOf({
      'notes/2026-08-12.md': '# 2026-08-12\n\n- [ ] Open since August\n',
      'notes/2026-09-18.md': '# 2026-09-18\n\n- [x] Done\n',
    });
    assert.strictEqual(
      planRollover(notes, '2026-09-19')?.tasks.length,
      1,
      'with no limit, an older note is still read',
    );
    assert.strictEqual(
      planRollover(notes, '2026-09-19', 14),
      undefined,
      'a fortnight does not reach August',
    );
  });

  test('has nothing to carry when the last note is done, or is today', () => {
    assert.strictEqual(
      planRollover(
        indexOf({ 'notes/2026-09-18.md': '# 2026-09-18\n\n- [x] All done\n' }),
        '2026-09-19',
      ),
      undefined,
    );
    assert.strictEqual(
      planRollover(
        indexOf({ 'notes/2026-09-19.md': '# 2026-09-19\n\n- [ ] Open\n' }),
        '2026-09-19',
      ),
      undefined,
      'today is not carried into itself',
    );
  });

  test('copies a task once however many days it has waited', async () => {
    const root = await createTemporaryRoot();
    const monday = vscode.Uri.joinPath(root, '2026-09-22.md');
    const tuesday = vscode.Uri.joinPath(root, '2026-09-23.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-24.md');
    const mondayText = '# 2026-09-22\n\n- [ ] Chase the vendor\n';
    // Tuesday's copy, and one task of its own.
    const tuesdayText = '# 2026-09-23\n\n- [ ] Chase the vendor\n- [ ] Book travel\n';
    await write(monday, mondayText);
    await write(tuesday, tuesdayText);
    await write(todayUri, '# 2026-09-24\n\n');
    const index = indexOf({ [monday.fsPath]: mondayText, [tuesday.fsPath]: tuesdayText });

    const plan = planRollover(index, '2026-09-24', 0, 'migrate');
    assert.deepStrictEqual(
      plan?.tasks.map((task) => [task.filePath, task.sourceLineText]),
      [
        [tuesday.fsPath, '- [ ] Chase the vendor'],
        [tuesday.fsPath, '- [ ] Book travel'],
      ],
      'the newest copy is the one carried',
    );
    assert.deepStrictEqual(plan?.fromDates, ['2026-09-23']);

    const result = await applyRollover(plan!, todayUri, 'copy', { history });
    assert.ok(result?.handle, 'a rollover that carried tasks has a way back');
    const { handle: _copied, ...copied } = result;
    assert.deepStrictEqual(copied, {
      carried: 2,
      skipped: 0,
      fromDates: ['2026-09-23'],
      notes: 1,
    });
    assert.strictEqual(
      (await read(todayUri)).split('Chase the vendor').length - 1,
      1,
      'the task arrives once',
    );
    assert.ok(
      (await read(tuesday)).includes('- [>] Chase the vendor → [[2026-09-24]]'),
      'copy is migrate now: the line left behind says where it went',
    );
    await deleteTemporaryRoot(root);
  });

  test('moving takes a task with everything under it, done steps and notes too', async () => {
    const root = await createTemporaryRoot();
    const fromUri = vscode.Uri.joinPath(root, '2026-09-18.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-19.md');
    const text = [
      '# 2026-09-18',
      '',
      '- [ ] Plan the offsite',
      '  - [x] Book the venue',
      '    a note on the venue',
      '  - [ ] Draft the email',
      '- [x] Old task',
      '  - [ ] Orphan step',
      '    - [ ] Its own step',
      '',
    ].join('\n');
    await write(fromUri, text);
    await write(todayUri, '# 2026-09-19\n\n- [ ] Something else\n');
    const plan = planRollover(indexOf({ [fromUri.fsPath]: text }), '2026-09-19');
    assert.ok(plan);
    const result = await applyRollover(plan, todayUri, 'move', { history });
    assert.strictEqual(result?.carried, 4);
    assert.strictEqual(
      await read(todayUri),
      [
        '# 2026-09-19',
        '',
        '- [ ] Something else',
        '',
        '## Carried over',
        '',
        '- [ ] Plan the offsite',
        '  - [x] Book the venue',
        '    a note on the venue',
        '  - [ ] Draft the email',
        '- [ ] Orphan step',
        '  - [ ] Its own step',
        '',
      ].join('\n'),
      'a step whose task stays is carried at the top level, never under another task',
    );
    assert.strictEqual(await read(fromUri), '# 2026-09-18\n\n- [x] Old task\n');
    await history.undo();
    await deleteTemporaryRoot(root);
  });

  test('migrating copies the open steps and marks each line left behind', async () => {
    const root = await createTemporaryRoot();
    const fromUri = vscode.Uri.joinPath(root, '2026-09-18.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-19.md');
    const text = [
      '# 2026-09-18',
      '- [ ] Plan the offsite',
      '  - [x] Book the venue',
      '  - [ ] Call Dana',
      '- [ ] Fix the roof',
      '  - [ ] Call Dana',
      '',
    ].join('\n');
    await write(fromUri, text);
    await write(todayUri, '# 2026-09-19\n');
    const plan = planRollover(indexOf({ [fromUri.fsPath]: text }), '2026-09-19', 0, 'migrate');
    assert.strictEqual(plan?.tasks.length, 4, 'two tasks\' "Call Dana" steps are two steps');
    const result = await applyRollover(plan!, todayUri, 'migrate', { history });
    assert.strictEqual(result?.carried, 4);
    assert.ok(
      (await read(todayUri)).includes(
        ['- [ ] Plan the offsite', '  - [ ] Call Dana', '- [ ] Fix the roof', '  - [ ] Call Dana'].join('\n'),
      ),
    );
    const left = await read(fromUri);
    assert.strictEqual(left.split('[>]').length - 1, 4, 'each carried line is marked');
    assert.ok(left.includes('  - [x] Book the venue'), 'a done step stays where it was');
    await history.undo();
    await deleteTemporaryRoot(root);
  });

  test('moving carries two alike lines, since they may be two tasks', () => {
    const plan = planRollover(
      indexOf({
        'notes/2026-09-22.md': '# 2026-09-22\n\n- [ ] Call Ren\n',
        'notes/2026-09-23.md': '# 2026-09-23\n\n- [ ] Call Ren\n',
      }),
      '2026-09-24',
      0,
      'move',
    );
    assert.strictEqual(plan?.tasks.length, 2);
  });

  test('moves the tasks into today, out of the note they came from', async () => {
    const root = await createTemporaryRoot();
    const fromUri = vscode.Uri.joinPath(root, '2026-09-18.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-19.md');
    await write(fromUri, yesterday);
    await write(todayUri, '# 2026-09-19\n\n');
    const plan = planRollover(
      indexOf({ [fromUri.fsPath]: yesterday }),
      '2026-09-19',
    );
    assert.ok(plan);

    const result = await applyRollover(plan, todayUri, 'move', { history });
    assert.ok(result?.handle, 'a rollover that carried tasks has a way back');
    const { handle: _moved, ...moved } = result;
    assert.deepStrictEqual(moved, {
      carried: 2,
      skipped: 0,
      fromDates: ['2026-09-18'],
      notes: 1,
    });
    assert.strictEqual(
      await read(todayUri),
      [
        '# 2026-09-19',
        '',
        '## Carried over',
        '',
        '- [ ] Chase the contractor 📅 2026-09-19 @dana',
        '  - [ ] Get the survey back',
        '',
      ].join('\n'),
      'under a Carried over heading, one level below the note\'s first',
    );
    assert.strictEqual(
      await read(fromUri),
      [
        '# 2026-09-18',
        '',
        '- [x] Filed the report',
        '',
        '## Notes',
        '',
        'It rained.',
        '',
      ].join('\n'),
      'the note keeps what was done, and its own prose',
    );

    // The rollover is one write, so it can be taken back as one.
    const undone = await history.undo();
    assert.strictEqual(undone?.restored, 2);
    assert.strictEqual(await read(fromUri), yesterday);
    assert.strictEqual(await read(todayUri), '# 2026-09-19\n\n');
    await deleteTemporaryRoot(root);
  });

  test('migrates, marking the line left behind, and never carries twice', async () => {
    const root = await createTemporaryRoot();
    const fromUri = vscode.Uri.joinPath(root, '2026-09-18.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-19.md');
    await write(fromUri, yesterday);
    await write(todayUri, '# 2026-09-19\n\n');
    const plan = planRollover(
      indexOf({ [fromUri.fsPath]: yesterday }),
      '2026-09-19',
    );
    assert.ok(plan);

    assert.strictEqual((await applyRollover(plan, todayUri, 'migrate', { history }))?.carried, 2);
    const left = await read(fromUri);
    assert.ok(
      left.includes('- [>] Chase the contractor 📅 2026-09-19 @dana → [[2026-09-19]]'),
      left,
    );
    assert.ok(left.includes('  - [>] Get the survey back → [[2026-09-19]]'), left);
    assert.strictEqual(
      parseMarkdown(fromUri.fsPath, left).tasks.filter((task) => !task.completed).length,
      0,
      'a migrated line is no longer an open task',
    );
    assert.deepStrictEqual(
      parseMarkdown(fromUri.fsPath, left.replace('@dana', '@dana #project/atlas')).sections
        .filter((section) => section.isInline)
        .map((section) => section.heading),
      [],
      'nor a note on a tag\'s page',
    );

    const again = await applyRollover(plan, todayUri, 'migrate', { history });
    assert.deepStrictEqual(again, {
      carried: 0,
      skipped: 2,
      fromDates: ['2026-09-18'],
      notes: 0,
    });
    assert.strictEqual(
      (await read(todayUri)).split('Chase the contractor').length - 1,
      1,
      'the task is in today once, however often the rollover runs',
    );
    await deleteTemporaryRoot(root);
  });

  test('leaves a task whose line has changed since indexing', async () => {
    const root = await createTemporaryRoot();
    const fromUri = vscode.Uri.joinPath(root, '2026-09-18.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-19.md');
    await write(fromUri, yesterday);
    await write(todayUri, '# 2026-09-19\n\n');
    const plan = planRollover(
      indexOf({ [fromUri.fsPath]: yesterday }),
      '2026-09-19',
    );
    assert.ok(plan);
    await write(
      fromUri,
      yesterday.replace('Chase the contractor', 'Chase them harder'),
    );

    const result = await applyRollover(plan, todayUri, 'move', { history });
    assert.strictEqual(result?.carried, 1);
    assert.strictEqual(result.skipped, 1);
    assert.ok(
      (await read(fromUri)).includes('Chase them harder'),
      'the line someone else changed is left as they left it',
    );
    await deleteTemporaryRoot(root);
  });

  test('adds to Carried over when it is there, and follows the note\'s heading level', () => {
    assert.deepStrictEqual(
      placeCarriedOver('# 2026-09-25\n\nMorning.\n\n## Carried over\n\n- [ ] One\n\n## Evening\n', ['- [ ] Two']),
      { start: { line: 7, character: 0 }, end: { line: 7, character: 0 }, text: '- [ ] Two\n' },
      'after what the heading already holds, before the next heading',
    );
    assert.strictEqual(
      placeCarriedOver('## 2026-09-25\n', ['- [ ] Two']).text,
      '\n\n### Carried over\n\n- [ ] Two\n',
    );
    assert.strictEqual(placeCarriedOver('', ['- [ ] Two']).text, '## Carried over\n\n- [ ] Two\n');
    assert.strictEqual(
      markMigrated('- [ ] Ship it 📅 2026-09-20 ^ship', 3, '2026-09-25'),
      '- [>] Ship it 📅 2026-09-20 → [[2026-09-25]] ^ship',
      'a block id stays last',
    );
  });

  test('reads Carried over\'s section as the parser does: a bare # ends it, and code does not', () => {
    assert.deepStrictEqual(
      placeCarriedOver('# 2026-09-25\n\n## Carried over\n\n- [ ] One\n\n#\n\nAfter.\n', ['- [ ] Two']),
      { start: { line: 5, character: 0 }, end: { line: 5, character: 0 }, text: '- [ ] Two\n' },
      'before the bare # that ends the section',
    );
    assert.deepStrictEqual(
      placeCarriedOver('# 2026-09-25\n\n## Carried over\n\n- [ ] One\n\n```\n# not a heading\n```\n', ['- [ ] Two']),
      { start: { line: 9, character: 0 }, end: { line: 9, character: 0 }, text: '\n- [ ] Two\n' },
      'after the code block, which is part of the section',
    );
    assert.strictEqual(
      placeCarriedOver('# 2026-09-25\n\n```\n## Carried over\n```\n', ['- [ ] Two']).text,
      '\n\n## Carried over\n\n- [ ] Two\n',
      'a Carried over heading in code is not one',
    );
    assert.strictEqual(
      placeCarriedOver('```\n# Example\n```\n## 2026-09-25\n', ['- [ ] Two']).text,
      '\n\n### Carried over\n\n- [ ] Two\n',
      'the first heading outside code sets the level',
    );
  });

  test('says in one sentence what it did, and where from', () => {
    assert.strictEqual(
      describeRollover(
        { carried: 3, skipped: 0, fromDates: ['2026-09-18'], notes: 1 },
        'move',
      ),
      'Moved 3 unfinished tasks forward from 2026-09-18.',
    );
    assert.strictEqual(
      describeRollover(
        {
          carried: 5,
          skipped: 0,
          fromDates: ['2026-08-12', '2026-09-09', '2026-09-18'],
          notes: 3,
        },
        'move',
      ),
      'Moved 5 unfinished tasks forward from 3 daily notes, back to 2026-08-12.',
    );
    assert.strictEqual(
      describeRollover(
        { carried: 1, skipped: 2, fromDates: ['2026-09-18'], notes: 1 },
        'migrate',
      ),
      'Migrated 1 unfinished task forward from 2026-09-18. 2 tasks stayed behind, already carried or changed since.',
    );
    assert.ok(
      describeRollover(
        { carried: 0, skipped: 1, fromDates: ['2026-09-18'], notes: 0 },
        'move',
      ).startsWith('Nothing was carried forward'),
    );
  });

  test('takes tasks out of each note it drew them from', async () => {
    const root = await createTemporaryRoot();
    const older = vscode.Uri.joinPath(root, '2026-09-11.md');
    const newer = vscode.Uri.joinPath(root, '2026-09-18.md');
    const todayUri = vscode.Uri.joinPath(root, '2026-09-19.md');
    await write(older, '# 2026-09-11\n\n- [ ] Open since last week\n');
    await write(newer, '# 2026-09-18\n\n- [ ] Chase the contractor\n');
    await write(todayUri, '# 2026-09-19\n\n');
    const plan = planRollover(
      indexOf({
        [older.fsPath]: '# 2026-09-11\n\n- [ ] Open since last week\n',
        [newer.fsPath]: '# 2026-09-18\n\n- [ ] Chase the contractor\n',
      }),
      '2026-09-19',
    );
    assert.ok(plan);

    const result = await applyRollover(plan, todayUri, 'move', { history });
    assert.strictEqual(result?.carried, 2);
    assert.strictEqual(result.notes, 2, 'two notes gave a task up');
    const today = await read(todayUri);
    assert.ok(today.includes('- [ ] Open since last week'), today);
    assert.ok(today.includes('- [ ] Chase the contractor'));
    assert.ok(!(await read(older)).includes('- [ ]'), 'the older note let go');
    assert.ok(!(await read(newer)).includes('- [ ]'), 'and so did the newer');
    await deleteTemporaryRoot(root);
  });
});

async function write(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

async function read(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-rollover-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temporaryRoot = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
  await vscode.workspace.fs.createDirectory(temporaryRoot);
  return temporaryRoot;
}

async function deleteTemporaryRoot(temporaryRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(temporaryRoot, {
    recursive: true,
    useTrash: false,
  });
}
