import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  applyRollover,
  describeRollover,
  planRollover,
} from '../ui/commands/rollover';
import { workspaceWrites } from '../ui/commands/workspaceWrites';

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

    const result = await applyRollover(plan, todayUri, 'move');
    assert.deepStrictEqual(result, {
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
        '- [ ] Chase the contractor 📅 2026-09-19 @dana',
        '  - [ ] Get the survey back',
        '',
        '',
      ].join('\n'),
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
    const undone = await workspaceWrites.undo();
    assert.strictEqual(undone?.restored, 2);
    assert.strictEqual(await read(fromUri), yesterday);
    assert.strictEqual(await read(todayUri), '# 2026-09-19\n\n');
    await deleteTemporaryRoot(root);
  });

  test('copies without emptying the note, and never carries twice', async () => {
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

    assert.strictEqual((await applyRollover(plan, todayUri, 'copy'))?.carried, 2);
    assert.strictEqual(await read(fromUri), yesterday, 'a copy leaves it alone');

    const again = await applyRollover(plan, todayUri, 'copy');
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

    const result = await applyRollover(plan, todayUri, 'move');
    assert.strictEqual(result?.carried, 1);
    assert.strictEqual(result.skipped, 1);
    assert.ok(
      (await read(fromUri)).includes('Chase them harder'),
      'the line someone else changed is left as they left it',
    );
    await deleteTemporaryRoot(root);
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
        'copy',
      ),
      'Copied 1 unfinished task forward from 2026-09-18. 2 tasks stayed behind, already carried or changed since.',
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

    const result = await applyRollover(plan, todayUri, 'move');
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
