import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { ParsedFile } from '../core/types';
import {
  appendTagToLine,
  applyBulkEdit,
  BulkEntry,
  describeBulkEdit,
  describeBulkEditResult,
} from '../ui/commands/bulkEdit';
import {
  describeEntry,
  listBulkEdits,
  parseBulkDate,
} from '../ui/commands/bulkEditPrompts';
import { parseSearchPageMessage } from '../ui/webview/messages';
import { workspaceWrites } from '../ui/commands/workspaceWrites';

const note = [
  '# Atlas #project/atlas',
  '',
  '## Decision',
  '',
  '- [ ] Chase the contractor 📅 2026-09-18',
  '- [ ] Book the room',
  '- [x] Filed the report',
  '- [ ] Water the plants 🔁 every week 📅 2026-09-19',
].join('\n');

suite('Bulk edits', () => {
  test('writes a tag at the end of a line, once', () => {
    assert.strictEqual(
      appendTagToLine('- [ ] Book the room', '#project/atlas'),
      '- [ ] Book the room #project/atlas',
    );
    assert.strictEqual(
      appendTagToLine('- [ ] Book the room  ', '#project/atlas'),
      '- [ ] Book the room #project/atlas',
      'the line keeps its words and loses only trailing space',
    );
    assert.strictEqual(
      appendTagToLine('- [ ] Book the room #project/atlas', '#project/atlas'),
      '- [ ] Book the room #project/atlas',
      'a line already carrying the tag is left alone',
    );
    assert.strictEqual(
      appendTagToLine('- [ ] Book the room', 'not a tag'),
      '- [ ] Book the room',
      'nothing but one tag is written',
    );
  });

  test('reads the date a reader writes', () => {
    const now = new Date(2026, 8, 19, 10, 0, 0).getTime();
    assert.deepStrictEqual(parseBulkDate('2026-09-20', now), {
      date: '2026-09-20',
    });
    assert.deepStrictEqual(parseBulkDate('today', now), { date: '2026-09-19' });
    assert.deepStrictEqual(parseBulkDate('Tomorrow', now), {
      date: '2026-09-20',
    });
    assert.deepStrictEqual(parseBulkDate('  ', now), { date: undefined });
    assert.strictEqual(parseBulkDate('next week', now), undefined);
  });

  test('offers notes only what a note can take', () => {
    assert.deepStrictEqual(
      listBulkEdits('notes').map((option) => option.label),
      ['Add a tag'],
    );
    assert.deepStrictEqual(
      listBulkEdits('tasks').map((option) => option.label),
      ['Complete', 'Reopen', 'Set a due date', 'Add a tag'],
    );
  });

  test('completes many tasks as one write, and takes it back', async () => {
    const { uri, file, read, clean } = await writeNote(note);
    const tasks = file.tasks.filter((task) => !task.completed);
    const entries: BulkEntry[] = tasks.map((task) => ({ kind: 'task', task }));

    const result = await applyBulkEdit(entries, {
      kind: 'complete',
      completed: true,
    });
    assert.strictEqual(result?.changed, 3);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.notes, 1);

    const after = await read();
    assert.ok(after.includes('- [x] Chase the contractor'), after);
    assert.ok(after.includes('- [x] Book the room'));
    assert.ok(
      after.includes('- [ ] Water the plants 🔁 every week 📅 2026-09-26'),
      'a repeating task leaves its next occurrence behind, as one checkbox does',
    );

    const undone = await workspaceWrites.undo();
    assert.strictEqual(undone?.restored, 1);
    assert.strictEqual(await read(), note);
    assert.ok(uri.fsPath.endsWith('.md'));
    await clean();
  });

  test('sets a due date, and leaves what is already as asked', async () => {
    const { file, read, clean } = await writeNote(note);
    const entries: BulkEntry[] = file.tasks
      .filter((task) => !task.completed)
      .map((task) => ({ kind: 'task', task }));

    const result = await applyBulkEdit(entries, {
      kind: 'due',
      date: '2026-10-01',
    });
    assert.strictEqual(result?.changed, 3);
    const after = await read();
    assert.ok(after.includes('- [ ] Chase the contractor 📅 2026-10-01'), after);
    assert.ok(after.includes('- [ ] Book the room 📅 2026-10-01'));

    const again = await applyBulkEdit(entries, {
      kind: 'complete',
      completed: false,
    });
    assert.deepStrictEqual(
      { changed: again?.changed, skipped: again?.skipped },
      { changed: 0, skipped: 3 },
      'the lines have changed since indexing, so nothing is overwritten',
    );
    await clean();
  });

  test('tags the notes a search found, headings and all', async () => {
    const { file, read, clean } = await writeNote(note);
    const entries: BulkEntry[] = file.sections
      .filter((section) => !section.isInline)
      .map((section) => ({ kind: 'section', section }));

    const result = await applyBulkEdit(entries, {
      kind: 'tag',
      tag: '#status/reviewed',
    });
    assert.strictEqual(result?.changed, 2);
    const after = await read();
    assert.ok(after.startsWith('# Atlas #project/atlas #status/reviewed'), after);
    assert.ok(after.includes('## Decision #status/reviewed'));
    await clean();
  });

  test('says what it is about to do, and what it did', () => {
    assert.strictEqual(
      describeBulkEdit({ kind: 'complete', completed: true }, 3),
      'completing 3 results',
    );
    assert.strictEqual(
      describeBulkEdit({ kind: 'due', date: undefined }, 1),
      'clearing the due date of 1 result',
    );
    assert.strictEqual(
      describeBulkEdit({ kind: 'tag', tag: '#a' }, 2),
      'adding #a to 2 results',
    );
    assert.strictEqual(
      describeBulkEditResult(
        { kind: 'tag', tag: '#a' },
        { changed: 2, skipped: 1, notes: 2 },
      ),
      'Added #a to 2 results in 2 notes. 1 was left as they are.',
    );
    assert.ok(
      describeBulkEditResult(
        { kind: 'complete', completed: true },
        { changed: 0, skipped: 2, notes: 0 },
      ).startsWith('Nothing to change'),
    );
  });

  test('reads a result the way the list of them shows it', () => {
    const file = parseMarkdown('notes/atlas.md', note);
    assert.deepStrictEqual(
      describeEntry({ kind: 'task', task: file.tasks[0] }),
      { label: '[ ] Chase the contractor', description: 'atlas.md:5' },
    );
    assert.deepStrictEqual(
      describeEntry({ kind: 'section', section: file.sections[0] }),
      { label: 'Atlas', description: 'atlas.md:1' },
    );
  });

  test('accepts the message the page posts, and nothing else', () => {
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'editResults', kind: 'tasks' }),
      { type: 'editResults', kind: 'tasks' },
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'editResults', kind: 'everything' }),
      undefined,
    );
  });
});

/** A note on disk, with the index's view of it. */
async function writeNote(content: string): Promise<{
  uri: vscode.Uri;
  file: ParsedFile;
  read: () => Promise<string>;
  clean: () => Promise<void>;
}> {
  const directoryName = `deckard-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const root = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
  await vscode.workspace.fs.createDirectory(root);
  const uri = vscode.Uri.joinPath(root, 'atlas.md');
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return {
    uri,
    file: parseMarkdown(uri.fsPath, content),
    read: async () =>
      Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),
    clean: () =>
      Promise.resolve(
        vscode.workspace.fs.delete(root, { recursive: true, useTrash: false }),
      ).then(() => undefined),
  };
}
