import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { listDailyNotes } from '../ui/commands/dailyNote';
import {
  installSample,
  resolveSampleTokens,
  SAMPLE_FOLDER_NAME,
  sampleFileName,
  takeSampleReadme,
} from '../ui/commands/sampleWorkspace';
import { createAgenda } from '../ui/state/agendaState';

suite('Sample workspace', () => {
  const extensionUri = vscode.Uri.file(path.resolve(__dirname, '..', '..'));
  // A Wednesday, well away from any week's edge.
  const today = new Date(2026, 9, 7, 9, 30);
  let storage: vscode.Uri;

  setup(async () => {
    storage = vscode.Uri.file(path.join(os.tmpdir(), `deckard-sample-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    await vscode.workspace.fs.createDirectory(storage);
  });
  teardown(async () => {
    await vscode.workspace.fs.delete(storage, { recursive: true, useTrash: false });
  });

  const read = async (uri: vscode.Uri) => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

  /** Every file installed, as path → text. */
  async function installed(target: vscode.Uri): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (folder: vscode.Uri, prefix: string) => {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
        const uri = vscode.Uri.joinPath(folder, name);
        if (type === vscode.FileType.Directory) {
          await walk(uri, `${prefix}${name}/`);
        } else {
          files.set(`${prefix}${name}`, await read(uri));
        }
      }
    };
    await walk(target, '');
    return files;
  }

  test('reads its dates from the day it is made', () => {
    assert.strictEqual(resolveSampleTokens('{{date}} {{date-9}} {{date+3}}', today), '2026-10-07 2026-09-28 2026-10-10');
    assert.strictEqual(sampleFileName('day-1.md', today), '2026-10-06.md');
    assert.strictEqual(sampleFileName('Harbor.md', today), 'Harbor.md');
    assert.strictEqual(sampleFileName('dot-vscode', today), '.vscode');
  });

  test('is nine notes dated around today: one task overdue, two due today, one this week', async () => {
    const { target, notes } = await installSample(extensionUri, storage, today);
    assert.strictEqual(path.basename(target.fsPath), SAMPLE_FOLDER_NAME);
    assert.strictEqual(notes, 9);
    const files = await installed(target);
    for (const [name, text] of files) {
      assert.ok(!text.includes('{{'), `${name} has no token left`);
    }
    const parsed = new Map(
      [...files]
        .filter(([name]) => name.endsWith('.md') && name !== 'README.md' && !name.includes('/'))
        .map(([name, text]) => [name, parseMarkdown(name, text)] as const),
    );
    assert.strictEqual(parsed.size, 9);
    const readme = files.get('README.md') ?? '';
    for (const name of parsed.keys()) {
      assert.ok(readme.includes(`\`${name}\``), `the README names ${name}`);
    }

    const index = buildWorkspaceIndex(parsed);
    const groups = createAgenda(index, today.getTime(), { upcomingDays: 7 });
    const count = (id: string) => groups.find((group) => group.id === id)?.entries.length ?? 0;
    assert.strictEqual(count('overdue'), 1, 'one task overdue');
    assert.strictEqual(count('today'), 2, 'two due today');
    assert.strictEqual(count('upcoming'), 1, 'one later this week');

    const statuses = [...index.tasks.values()]
      .filter((task) => !task.completed)
      .flatMap((task) => task.tags.filter((tag) => tag.startsWith('#status/')));
    assert.strictEqual(statuses.length, 3);
    assert.strictEqual(new Set(statuses).size, 3, 'doing, todo, and waiting');

    const days = listDailyNotes(index).map((entry) => entry.date);
    assert.ok(days.includes('2026-10-06') && days.includes('2026-10-07'), 'yesterday and today have daily notes');

    const settings = JSON.parse(files.get('.vscode/settings.json') ?? '{}') as Record<string, unknown>;
    assert.strictEqual(settings['deckard.notesFolder'], '');
  });

  test('is replaced only when asked, and never merged onto what is there', async () => {
    const { target } = await installSample(extensionUri, storage, today);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(target, 'mine.md'), Buffer.from('# Mine\n'));
    await assert.rejects(() => installSample(extensionUri, storage, today), /already a sample/);
    await installSample(extensionUri, storage, today, vscode.workspace.fs, { replace: true });
    assert.ok(!(await installed(target)).has('mine.md'), 'a fresh copy');
  });

  test('shows its README only in the folder it opened', () => {
    const sample = vscode.Uri.file('/storage/deckard-sample');
    assert.strictEqual(
      takeSampleReadme(sample.toString(), [{ uri: sample }])?.toString(),
      vscode.Uri.joinPath(sample, 'README.md').toString(),
    );
    assert.strictEqual(takeSampleReadme(sample.toString(), [{ uri: vscode.Uri.file('/work') }]), undefined);
    assert.strictEqual(takeSampleReadme(undefined, [{ uri: sample }]), undefined);
  });
});
