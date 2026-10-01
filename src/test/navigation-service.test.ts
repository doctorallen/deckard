import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { NavigationService, SourcePolicy, TagPolicy } from '../services/navigationService';

// The fixture navigation.e2e.js pins the hosts with: one note of each shape
// the rules tell apart.
const NOTES: Array<[string, string]> = [
  // An entry at line 1, a plain line at 2, and a task at 3.
  ['/notes/atlas.md', '# Atlas #project/relay\nSome words about it.\n- [ ] Call the vendor\n'],
  // No entry; tagged in its front matter only. Line 4 is its text.
  ['/notes/tagged.md', '---\ntags: [relay]\n---\nOnly front matter tags.\n'],
  // No entry and no tag; one link.
  ['/notes/linking.md', 'See [[atlas]] for more.\n'],
  // No entry, no tag, no link.
  ['/notes/plain.md', 'Nothing to see here.\n'],
];

const index = buildWorkspaceIndex(
  new Map(NOTES.map(([filePath, text]) => [filePath, parseMarkdown(filePath, text)])),
);
const entry = [...index.sections.values()].find((section) => section.filePath === '/notes/atlas.md')?.id;
const navigation = new NavigationService();

/** Where each policy lands a line: `visit`, `open`, or `none`. */
const SOURCES: Array<[string, number, Record<SourcePolicy, 'visit' | 'open' | 'none'>]> = [
  ['/notes/atlas.md', 1, { entries: 'visit', graphNodes: 'open', tasks: 'none', notes: 'visit' }],
  ['/notes/atlas.md', 2, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'open' }],
  ['/notes/atlas.md', 3, { entries: 'open', graphNodes: 'open', tasks: 'open', notes: 'open' }],
  ['/notes/tagged.md', 1, { entries: 'open', graphNodes: 'open', tasks: 'none', notes: 'open' }],
  ['/notes/tagged.md', 4, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'open' }],
  ['/notes/linking.md', 1, { entries: 'none', graphNodes: 'open', tasks: 'none', notes: 'open' }],
  ['/notes/plain.md', 1, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'open' }],
  ['/notes/missing.md', 1, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'none' }],
];

suite('NavigationService', () => {
  test('opens a line only where its policy accepts it, counting an entry\'s visit where the policy does', () => {
    for (const [filePath, line, expected] of SOURCES) {
      for (const policy of Object.keys(expected) as SourcePolicy[]) {
        const want = {
          visit: { kind: 'open', filePath, line, visit: entry },
          open: { kind: 'open', filePath, line },
          none: { kind: 'unknown' },
        }[expected[policy]];
        assert.deepStrictEqual(
          navigation.resolveSourceLocation(index, filePath, line, policy),
          want,
          `${filePath}:${line} under ${policy}`,
        );
      }
    }
  });

  test('finds a tag as the reader wrote it, or only by its exact key', () => {
    const cases: Array<[string, Record<TagPolicy, string | undefined>]> = [
      ['#project/relay', { lenient: '#project/relay', exact: '#project/relay' }],
      ['project/relay', { lenient: '#project/relay', exact: undefined }],
      ['#Project/Relay', { lenient: '#project/relay', exact: undefined }],
      [' #project/relay ', { lenient: '#project/relay', exact: undefined }],
      ['relay', { lenient: '#relay', exact: undefined }],
      ['#gone', { lenient: undefined, exact: undefined }],
      ['', { lenient: undefined, exact: undefined }],
    ];
    for (const [tagKey, expected] of cases) {
      for (const policy of ['lenient', 'exact'] as TagPolicy[]) {
        const found = expected[policy];
        assert.deepStrictEqual(
          navigation.resolveTag(index, tagKey, policy),
          found === undefined ? { kind: 'unknown' } : { kind: 'open', tagKey: found },
          `${JSON.stringify(tagKey)} under ${policy}`,
        );
      }
    }
  });
});
