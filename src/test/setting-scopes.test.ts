import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');

/**
 * The settings the scanner reads for each workspace folder on its own
 * (`WorkspaceScanner.getNotesFolder`, `getTemplatesFolderUri`,
 * `getParseOptions`, and `getParkedRules`), so a folder may set its own.
 */
const READ_PER_FOLDER = [
  'deckard.notesFolder',
  'deckard.templatesFolder',
  'deckard.exclude',
  'deckard.noteBoundaries',
  'deckard.entityNamespaceAliases',
  'deckard.parked.folders',
];

suite('Setting scopes', () => {
  test('a setting read per workspace folder can be set per folder', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: { configuration: Array<{ properties: Record<string, { scope?: string }> }> };
    };
    const settings = Object.assign(
      {},
      ...manifest.contributes.configuration.map((section) => section.properties),
    ) as Record<string, { scope?: string }>;
    // VS Code ignores a folder's value for a setting without "resource" scope
    // (the default is "window"), so a multi-root workspace could not give
    // each folder its own.
    assert.deepStrictEqual(
      READ_PER_FOLDER.filter((key) => settings[key]?.scope !== 'resource'),
      [],
    );
  });
});
