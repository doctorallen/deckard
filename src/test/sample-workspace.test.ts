import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { findMissingLinkTargets } from '../domain/index/backlinks';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  getSampleStorageUri,
  installSample,
  isSampleNote,
  WORK_SAMPLE_FOLDER_NAME,
  takeSampleReadme,
} from '../ui/commands/sampleWorkspace';
import { resolveSampleTokens, sampleFileName } from '../domain/notes/sampleNotes';
import { createQueryContext } from '../domain/query/queryContext';
import { ParsedFile } from '../domain/model';

suite('Work sample', () => {
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

  test('the work sample is a team lead\'s week: every link opens a note, and today has work due', async () => {
    const { target, notes } = await installSample({ extensionUri, storageUri: storage, today });
    assert.strictEqual(path.basename(target.fsPath), WORK_SAMPLE_FOLDER_NAME);
    const files = await installed(target);
    for (const [name, text] of files) {
      assert.ok(!text.includes('{{'), `${name} has no token left`);
    }
    const parsed = new Map<string, ParsedFile>(
      [...files]
        .filter(([name]) => name.endsWith('.md') && !name.startsWith('templates/'))
        .map(([name, text]) => [name, parseMarkdown(name, text, undefined, { typeNote: name.startsWith('Types/') })] as const),
    );
    const index = buildWorkspaceIndex(parsed);
    assert.strictEqual(notes, index.files.size - 1, 'every note but the README, and no type note');
    assert.deepStrictEqual([...(index.typeNotes?.keys() ?? [])].sort(), ['Types/Area.md', 'Types/Decision.md', 'Types/Person.md', 'Types/Team.md']);
    assert.deepStrictEqual(findMissingLinkTargets(index), [], 'no link names a missing note');
    assert.ok(files.has('2026-10-07.md') && files.has('2026-10-06.md'), 'standups dated to the days before it was made');
    const context = createQueryContext(new Date(2026, 9, 7, 12).getTime());
    const due = (query: string) => evaluateQuery(index, parseQuery(query).node!, context).tasks.length;
    assert.ok(due('is:today') >= 2, 'work due today');
    assert.ok(due('is:overdue') >= 1, 'something slipped');
    assert.ok(due('assignee = @theo-park') >= 1, 'a task handed to someone');
    assert.ok([...parsed.values()].some((file) => file.hub?.describes.some((tag) => tag.key === '#project/checkout-v2')), 'a project hub');
    assert.match(files.get('README.md') ?? '', /Cmd.*macOS|macOS.*Cmd/s, 'keys for macOS beside Windows and Linux');
    assert.deepStrictEqual(
      ['templates/Meeting.md', 'templates/One-on-one.md', 'templates/Decision record.md'].filter((name) => !files.has(name)),
      [],
    );
  });

  test('reads its dates from the day it is made', () => {
    assert.strictEqual(resolveSampleTokens('{{date}} {{date-9}} {{date+3}}', today), '2026-10-07 2026-09-28 2026-10-10');
    assert.strictEqual(resolveSampleTokens('{{month+1}} {{month-1}}', today), '2026-11-15 2026-09-15');
    assert.strictEqual(resolveSampleTokens('{{month+1}}', new Date(2026, 11, 31)), '2027-01-15', 'into the next year');
    assert.strictEqual(sampleFileName('day-1.md', today), '2026-10-06.md');
    assert.strictEqual(sampleFileName('Harbor.md', today), 'Harbor.md');
    assert.strictEqual(sampleFileName('dot-vscode', today), '.vscode');
    assert.ok(isSampleNote('projects/Checkout v2.md'));
    assert.ok(!isSampleNote('README.md') && !isSampleNote('templates/Meeting.md') && !isSampleNote('Types/Team.md'));
  });

  test('is replaced only when asked, and never merged onto what is there', async () => {
    const { target } = await installSample({ extensionUri, storageUri: storage, today });
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(target, 'mine.md'), Buffer.from('# Mine\n'));
    await assert.rejects(() => installSample({ extensionUri, storageUri: storage, today }), /already a sample/);
    await installSample({ extensionUri, storageUri: storage, today, fs: vscode.workspace.fs, replace: true });
    assert.ok(!(await installed(target)).has('mine.md'), 'a fresh copy');
  });

  test('shows its README only in the folder it opened', () => {
    const sample = vscode.Uri.file('/storage/deckard-work-sample');
    assert.strictEqual(
      takeSampleReadme(sample.toString(), [{ uri: sample }])?.toString(),
      vscode.Uri.joinPath(sample, 'README.md').toString(),
    );
    assert.strictEqual(takeSampleReadme(sample.toString(), [{ uri: vscode.Uri.file('/work') }]), undefined);
    assert.strictEqual(takeSampleReadme(undefined, [{ uri: sample }]), undefined);
  });

  test('opens as a file folder, which VS Code can search', () => {
    // A `vscode-userdata:` folder has no file search, so its first scan
    // never finished.
    const userData = vscode.Uri.from({
      scheme: 'vscode-userdata',
      path: '/Users/reader/Library/Application Support/Code/User/globalStorage/esperinnovations.deckard-notes',
    });
    const opened = getSampleStorageUri(userData);
    assert.strictEqual(opened.scheme, 'file');
    assert.strictEqual(opened.fsPath, userData.fsPath);
    const file = vscode.Uri.file(os.tmpdir());
    assert.strictEqual(getSampleStorageUri(file), file);
  });
});
