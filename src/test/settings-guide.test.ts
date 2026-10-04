import * as assert from 'assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository's root, from the compiled test in out/test. */
const ROOT = join(__dirname, '..', '..');

suite('The settings guide', () => {
  test('documents every setting Deckard contributes', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      contributes: { configuration: { properties?: Record<string, unknown> } | Array<{ properties?: Record<string, unknown> }> };
    };
    const sections = ([] as Array<{ properties?: Record<string, unknown> }>).concat(manifest.contributes.configuration);
    const keys = sections.flatMap((section) => Object.keys(section.properties ?? {}));
    const guide = readFileSync(join(ROOT, 'docs', 'guide', 'settings.md'), 'utf8');
    const missing = keys.filter((key) => !guide.includes(`| \`${key}\` |`));
    assert.ok(keys.length > 50, 'the manifest was read');
    assert.deepStrictEqual(missing, [], `docs/guide/settings.md has no row for: ${missing.join(', ')}`);
  });
});
