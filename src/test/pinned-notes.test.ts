import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { normalizePinnedNotes, pinKey } from '../core/storage/preferences';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { parseSearchPageMessage } from '../ui/webview/messages';
import { createPinForLine, resolvePin } from '../ui/state/pinnedNotes';

const note = [
  '# Atlas', // 1
  '', // 2
  'Intro.', // 3
  '', // 4
  '## Vendor review', // 5
  '', // 6
  'The survey slipped.', // 7
  '', // 8
  '## Decision', // 9
  '', // 10
  'We sign.', // 11
].join('\n');

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

const index = indexOf({ 'notes/atlas.md': note });

suite('Pinned notes', () => {
  test('pins the entry a line sits in, not the file it is in', () => {
    assert.deepStrictEqual(createPinForLine(index, 'notes/atlas.md', 7), {
      filePath: 'notes/atlas.md',
      heading: 'Vendor review',
      headingLevel: 2,
      occurrence: 0,
    });
    assert.deepStrictEqual(createPinForLine(index, 'notes/atlas.md', 11), {
      filePath: 'notes/atlas.md',
      heading: 'Decision',
      headingLevel: 2,
      occurrence: 0,
    });
    assert.strictEqual(
      createPinForLine(index, 'notes/gone.md', 1),
      undefined,
      'a note Deckard has not indexed cannot be pinned',
    );
  });

  test('a note with no heading above the line pins the note itself', () => {
    const frontmatter = indexOf({
      'notes/person.md': '---\npeople: [ren-kade]\n---\n\nNo headings here.\n',
    });
    assert.deepStrictEqual(createPinForLine(frontmatter, 'notes/person.md', 5), {
      filePath: 'notes/person.md',
    });
  });

  test('follows its heading when the note is written above it', () => {
    const pin = createPinForLine(index, 'notes/atlas.md', 7);
    assert.ok(pin);
    const moved = indexOf({
      'notes/atlas.md': note.replace('Intro.', 'Intro.\n\nAnd more.\n\nAnd more.'),
    });
    const resolved = resolvePin(moved, pin);
    assert.strictEqual(resolved?.title, 'Vendor review');
    assert.strictEqual(resolved?.line, 9, 'the heading moved down four lines');
    assert.strictEqual(resolved?.detail, 'atlas.md · notes');
  });

  test('keeps the note when its heading is gone, and says so', () => {
    const pin = createPinForLine(index, 'notes/atlas.md', 7);
    assert.ok(pin);
    const renamed = indexOf({
      'notes/atlas.md': note.replace('## Vendor review', '## Supplier review'),
    });
    const resolved = resolvePin(renamed, pin);
    assert.strictEqual(resolved?.line, 1);
    assert.strictEqual(resolved?.title, 'Vendor review');
    assert.match(resolved?.detail ?? '', /heading not found$/);
    assert.strictEqual(
      resolvePin(indexOf({}), pin),
      undefined,
      'a pin whose note is gone is dropped',
    );
  });

  test('tells two headings of the same text apart', () => {
    const repeated = indexOf({
      'notes/log.md': ['# Log', '## Notes', 'One.', '## Notes', 'Two.'].join('\n'),
    });
    const second = createPinForLine(repeated, 'notes/log.md', 5);
    assert.strictEqual(second?.occurrence, 1);
    assert.strictEqual(resolvePin(repeated, second)?.line, 4);
    const first = createPinForLine(repeated, 'notes/log.md', 3);
    assert.strictEqual(first?.occurrence, 0);
    assert.strictEqual(resolvePin(repeated, first)?.line, 2);
    assert.notStrictEqual(pinKey(first), pinKey(second));
  });

  test('reads the pins a workspace kept, whichever shape they are in', () => {
    assert.deepStrictEqual(
      normalizePinnedNotes(['notes/a.md', { filePath: 'notes/b.md' }]),
      [{ filePath: 'notes/a.md' }, { filePath: 'notes/b.md' }],
      'a path was a pin on the whole note, which is what it meant',
    );
    assert.deepStrictEqual(
      normalizePinnedNotes([
        {
          filePath: 'notes/a.md',
          heading: 'Decision',
          headingLevel: 2,
          occurrence: 1,
        },
      ]),
      [
        {
          filePath: 'notes/a.md',
          heading: 'Decision',
          headingLevel: 2,
          occurrence: 1,
        },
      ],
    );
    assert.deepStrictEqual(
      normalizePinnedNotes([
        'notes/a.md',
        'notes/a.md',
        { filePath: '' },
        { heading: 'No path' },
        7,
        null,
      ]),
      [{ filePath: 'notes/a.md' }],
      'one pin per thing, and nothing that is not a pin',
    );
    assert.deepStrictEqual(normalizePinnedNotes('not a list'), []);
  });

  test('accepts the pin a search result posts', () => {
    assert.deepStrictEqual(
      parseSearchPageMessage({
        type: 'pinNote',
        filePath: 'notes/atlas.md',
        line: 5,
      }),
      { type: 'pinNote', filePath: 'notes/atlas.md', line: 5 },
    );
    assert.deepStrictEqual(
      parseSearchPageMessage({ type: 'unpinNote', filePath: 'notes/atlas.md' }),
      { type: 'unpinNote', filePath: 'notes/atlas.md' },
    );
    assert.strictEqual(
      parseSearchPageMessage({ type: 'pinNote', filePath: '' }),
      undefined,
    );
  });
});
