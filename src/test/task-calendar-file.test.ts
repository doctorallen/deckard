import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { buildCalendarFor, resolveCalendarFile } from '../ui/commands/taskCalendarFile';

suite('The calendar file', () => {
  const file = parseMarkdown(
    'notes/atlas.md',
    '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-10-09\n- [ ] Book the room ⏳ 2026-10-06\n- [ ] Someday\n- [x] Done 📅 2026-10-01',
  );
  const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
  const indexer = { getUri: (filePath: string) => vscode.Uri.file(`/work/${filePath}`) };
  const context = createQueryContext(new Date(2026, 9, 3).getTime());

  test('lists the dated tasks its search finds, soonest first, each linking to its line', () => {
    const built = buildCalendarFor(indexer, index, 'is:open', context);
    assert.strictEqual(built.kind, 'calendar');
    if (built.kind !== 'calendar') {
      return;
    }
    assert.strictEqual(built.count, 2, 'the undated and the done task are left out');
    const summaries = built.text.split('\r\n').filter((line) => line.startsWith('SUMMARY:'));
    assert.deepStrictEqual(summaries, ['SUMMARY:Book the room', 'SUMMARY:Send the proposal']);
    assert.ok(built.text.replace(/\r\n /g, '').includes(`URL:${vscode.env.uriScheme}://file/work/notes/atlas.md:3`));
  });

  test('says why when its search does not run', () => {
    const built = buildCalendarFor(indexer, index, '(is:open', context);
    assert.strictEqual(built.kind, 'error');
  });

  test('takes an absolute path as it is, and nothing for an empty one', () => {
    assert.strictEqual(resolveCalendarFile('')?.fsPath, undefined);
    assert.strictEqual(resolveCalendarFile('   '), undefined);
    const absolute = process.platform === 'win32' ? 'C:\\cal\\tasks.ics' : '/tmp/cal/tasks.ics';
    assert.strictEqual(resolveCalendarFile(absolute)?.fsPath, vscode.Uri.file(absolute).fsPath);
  });
});
