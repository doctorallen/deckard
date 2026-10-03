import * as assert from 'assert';

import type { ResourceUri } from '../ports/uri';
import { TemplateService } from '../services/templateService';
import { fileUri, joinUri } from './fakeWorkspace';

// TemplateService fills a template and makes the note, never over one that
// is there; these run it over files held in memory and a clock held still.

/** Files in memory by path, and the folders made. */
function filesWith(existing: string[] = []) {
  const written = new Map<string, string>();
  const folders: string[] = [];
  const present = new Set(existing);
  return {
    written,
    folders,
    files: {
      joinPath: joinUri,
      stat: (uri: ResourceUri) =>
        present.has(uri.path) || written.has(uri.path)
          ? Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 })
          : Promise.reject(new Error('missing')),
      createDirectory: (uri: ResourceUri) => {
        folders.push(uri.path);
        return Promise.resolve();
      },
      writeFile: (uri: ResourceUri, content: Uint8Array) => {
        written.set(uri.path, new TextDecoder().decode(content));
        return Promise.resolve();
      },
    },
  };
}

const NOTES = fileUri('/ws/notes');

/** A service whose index takes in notes under /ws/notes, at 09:05 on 2026-09-30. */
function templatesWith(existing: string[] = []) {
  const fake = filesWith(existing);
  const service = new TemplateService<ResourceUri>({
    files: fake.files,
    index: { isNotesFile: (uri) => uri.path.startsWith('/ws/notes/') },
    clock: { now: () => new Date(2026, 8, 30, 9, 5).getTime() },
  });
  return { service, ...fake };
}

suite('TemplateService', () => {
  test('fills the template and writes the note, making its folder', async () => {
    const { service, written, folders } = templatesWith();

    const result = await service.createNote({
      template: '# {title}\n\n{date} {time} for {ask:Client}. {unknown}\n',
      fileName: 'Kickoff.md',
      answers: new Map([['Client', 'Atlas']]),
      folder: NOTES,
    });

    assert.strictEqual(result.kind, 'created');
    assert.strictEqual(result.uri.path, '/ws/notes/Kickoff.md');
    assert.strictEqual(result.kind === 'created' && result.indexed, true);
    assert.deepStrictEqual(folders, ['/ws/notes']);
    assert.strictEqual(written.get('/ws/notes/Kickoff.md'), '# Kickoff\n\n2026-09-30 09:05 for Atlas. {unknown}\n');
  });

  test('never writes over a note that is there', async () => {
    const { service, written } = templatesWith(['/ws/notes/Kickoff.md']);
    const result = await service.createNote({ template: 'new', fileName: 'Kickoff.md', answers: new Map(), folder: NOTES });
    assert.strictEqual(result.kind, 'exists');
    assert.strictEqual(result.uri.path, '/ws/notes/Kickoff.md');
    assert.strictEqual(written.size, 0);
  });

  test('says when the note went where Deckard does not look', async () => {
    const { service } = templatesWith();
    const result = await service.createNote({
      template: '# {title}',
      fileName: 'Loose.md',
      answers: new Map(),
      folder: fileUri('/ws/elsewhere'),
    });
    assert.deepStrictEqual(result.kind === 'created' && [result.uri.path, result.indexed], ['/ws/elsewhere/Loose.md', false]);
  });
});
