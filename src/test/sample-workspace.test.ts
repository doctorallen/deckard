import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  getSampleSourceUri,
  installSample,
  SAMPLE_FOLDER_NAME,
} from '../ui/commands/sampleWorkspace';

suite('Sample workspace', () => {
  const extensionUri = vscode.Uri.file(path.resolve(__dirname, '..', '..'));
  let parent: vscode.Uri;

  setup(async () => {
    parent = vscode.Uri.file(path.join(os.tmpdir(), `deckard-sample-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    await vscode.workspace.fs.createDirectory(parent);
  });
  teardown(async () => {
    await vscode.workspace.fs.delete(parent, { recursive: true, useTrash: false });
  });

  test('ships with the extension, and shows what it claims to', async () => {
    const source = getSampleSourceUri(extensionUri);
    const files = new Map<string, ReturnType<typeof parseMarkdown>>();
    for (const [name, type] of await vscode.workspace.fs.readDirectory(source)) {
      if (type === vscode.FileType.File && name.endsWith('.md') && name !== 'README.md') {
        const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(source, name))).toString('utf8');
        files.set(name, parseMarkdown(name, content));
      }
    }
    const index = buildWorkspaceIndex(files);
    assert.strictEqual(index.files.size, 7, 'seven notes');
    assert.ok(index.tasks.size >= 10, 'tasks to put on a board');
    assert.ok([...index.tasks.values()].some((task) => task.dueAt !== undefined && task.priority), 'a dated, prioritized task');
    assert.ok([...index.entities.values()].filter((entity) => entity.kind === 'person').length >= 3, 'people');
    assert.ok([...files.values()].filter((file) => file.hub).length >= 3, 'hub notes with describes:');
    const readme = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(source, 'README.md'))).toString('utf8');
    for (const name of files.keys()) {
      assert.ok(readme.includes(`\`${name}\``), `the README says what ${name} shows`);
    }
  });

  test('copies into a folder of its own, and refuses to land on one already there', async () => {
    const { target, files } = await installSample(extensionUri, parent);
    assert.strictEqual(path.basename(target.fsPath), SAMPLE_FOLDER_NAME);
    assert.ok(files.includes('README.md') && files.includes('2026-08-02.md'));
    assert.strictEqual(files.length, 8);

    await assert.rejects(
      () => installSample(extensionUri, parent),
      /already a "deckard-sample" folder/,
      'nothing is merged onto what is there',
    );
  });
});
