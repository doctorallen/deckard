import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
  compareVersions,
  isFeatureUpdate,
  parseChangelog,
  releasesWithHighlights,
  renderHighlightHtml,
} from '../core/changelog';

/** The release script, which the workflows run with Node. */
interface ChangelogScript {
  cutChangelog(
    text: string,
    options: { version: string; date: string; baseVersion: string; commits?: string[] },
  ): string;
  releaseNotes(text: string, version: string): string;
  checkChangelog(text: string): string[];
  hasHighlights(body: string): boolean;
  isFeatureRelease(version: string): boolean;
}

// out/test is two levels below the repository, as the source is.
const root = path.join(__dirname, '..', '..');
const script = require(path.join(root, 'scripts', 'changelog.js')) as ChangelogScript;

const BEFORE = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '### Changed',
  '',
  '- **One.** First.',
  '',
  '### Fixed',
  '',
  '- **Two.** Second.',
  '',
  '### Changed',
  '',
  '- **Three.** Third.',
  '',
  '## 1.21.0 - 2026-09-20',
  '',
  '### Added',
  '',
  '- Old.',
  '',
].join('\n');

suite('Changelog', () => {
  test('reads each release and its Highlights, wrapped bullets and all', () => {
    const releases = parseChangelog(
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Highlights',
        '',
        '- Soon.',
        '',
        '## 1.23.0 - 2026-10-02',
        '',
        '### Highlights',
        '',
        '- Tasks wait under **Needs a new date**, and',
        '  wrap onto a second line.',
        '- `Deckard: Choose Theme…` previews.',
        '',
        '### Added',
        '',
        '- Not a highlight.',
        '',
        '## 1.14.0 - 2026-09-17',
        '',
        '### Fixed',
        '',
        '- Old.',
      ].join('\n'),
    );
    assert.deepStrictEqual(releases, [
      { version: 'Unreleased', highlights: ['Soon.'] },
      {
        version: '1.23.0',
        date: '2026-10-02',
        highlights: ['Tasks wait under **Needs a new date**, and wrap onto a second line.', '`Deckard: Choose Theme…` previews.'],
      },
      { version: '1.14.0', date: '2026-09-17', highlights: [] },
    ]);
    assert.deepStrictEqual(
      releasesWithHighlights(releases, '1.22.0', '1.23.0').map((release) => release.version),
      ['1.23.0'],
    );
  });

  test('knows a feature update from a patch or a downgrade', () => {
    assert.strictEqual(isFeatureUpdate('1.22.0', '1.23.0'), true);
    assert.strictEqual(isFeatureUpdate('1.22.0', '1.22.1'), false);
    assert.strictEqual(isFeatureUpdate('1.22.0', '2.0.0'), true);
    assert.strictEqual(isFeatureUpdate('1.23.0', '1.22.0'), false);
    assert.strictEqual(compareVersions('1.10.0', '1.9.3'), 1);
  });

  test('a Highlight keeps bold and code, and nothing else', () => {
    assert.strictEqual(
      renderHighlightHtml('**Bold** and `code` <script>alert(1)</script>'),
      '<strong>Bold</strong> and <code>code</code> &lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  test("a feature release has one to three short Highlights", () => {
    const version = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const [major, minor, patch] = version.split('.').map(Number);
    if (patch !== 0 || compareVersions(version, '1.23.0') < 0 || (major === 1 && minor < 23)) {
      return;
    }
    const release = parseChangelog(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')).find(
      (candidate) => candidate.version === version,
    );
    assert.ok(release, `CHANGELOG.md has a section for ${version}`);
    assert.ok(release.highlights.length >= 1 && release.highlights.length <= 3, 'one to three Highlights');
    release.highlights.forEach((text) => assert.ok(text.length <= 140, `at most 140 characters: ${text}`));
  });

  test('cuts Unreleased into the version, opens a fresh one, and merges repeated groups', () => {
    const cut = script.cutChangelog(BEFORE, {
      version: '1.22.0',
      date: '2026-09-25',
      baseVersion: '1.21.0',
    });
    assert.strictEqual(
      cut,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '## 1.22.0 - 2026-09-25',
        '',
        '### Changed',
        '',
        '- **One.** First.',
        '',
        '- **Three.** Third.',
        '',
        '### Fixed',
        '',
        '- **Two.** Second.',
        '',
        '## 1.21.0 - 2026-09-20',
        '',
        '### Added',
        '',
        '- Old.',
        '',
      ].join('\n'),
    );
    assert.deepStrictEqual(script.checkChangelog(cut), []);
  });

  test('folds an earlier cut of this release when it is cut again', () => {
    const once = script.cutChangelog(BEFORE, {
      version: '1.21.1',
      date: '2026-09-24',
      baseVersion: '1.21.0',
    });
    const withMore = once.replace('## Unreleased\n', '## Unreleased\n\n### Highlights\n\n- New.\n');
    const twice = script.cutChangelog(withMore, {
      version: '1.22.0',
      date: '2026-09-25',
      baseVersion: '1.21.0',
    });
    assert.ok(!twice.includes('1.21.1'), twice);
    const notes = script.releaseNotes(twice, '1.22.0');
    assert.ok(notes.startsWith('### Highlights\n\n- New.'), notes);
    assert.ok(notes.includes('- **Three.** Third.'));
    assert.ok(script.hasHighlights(notes));
  });

  test('writes a release with no entries from its feat and fix subjects', () => {
    const empty = '# Changelog\n\n## Unreleased\n\n## 1.21.0 - 2026-09-20\n\n- Old.\n';
    const cut = script.cutChangelog(empty, {
      version: '1.21.1',
      date: '2026-09-25',
      baseVersion: '1.21.0',
      commits: ['fix: a thing works', 'chore: tidy', 'feat(board): cards move', 'docs: words'],
    });
    assert.strictEqual(
      script.releaseNotes(cut, '1.21.1'),
      '### Added\n\n- Cards move\n\n### Fixed\n\n- A thing works\n',
    );
  });

  test('gives the release page only its own section', () => {
    assert.strictEqual(script.releaseNotes(BEFORE, '1.21.0'), '### Added\n\n- Old.\n');
    assert.strictEqual(script.releaseNotes(BEFORE, '9.9.9'), '');
  });

  test('knows a feature release, which must have Highlights', () => {
    assert.strictEqual(script.isFeatureRelease('1.23.0'), true);
    assert.strictEqual(script.isFeatureRelease('1.23.1'), false);
    assert.strictEqual(script.hasHighlights('### Fixed\n\n- x\n'), false);
  });

  test('finds a changelog out of shape', () => {
    assert.deepStrictEqual(script.checkChangelog('# Changelog\n\n## 1.0.0 - 2026-01-01\n'), [
      'The first section must be ## Unreleased.',
    ]);
    assert.deepStrictEqual(
      script.checkChangelog('## Unreleased\n\n## 1.0.0 - 2026-01-01\n\n## 1.1.0 - 2026-02-01\n'),
      ['1.1.0 is not older than the section above it.'],
    );
    assert.deepStrictEqual(script.checkChangelog('## Unreleased\n\n## 1.0.0\n'), [
      '"## 1.0.0" is not "## X.Y.Z - YYYY-MM-DD".',
    ]);
  });

  test('the repository changelog is in shape', () => {
    const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.deepStrictEqual(script.checkChangelog(text), []);
  });
});
