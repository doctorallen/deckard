import * as assert from 'assert';

import { findMissingLinkTargets, getBacklinkIndex } from '../domain/index/backlinks';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { findLinkProblems } from '../domain/links/linkProblems';
import { parseMarkdown } from '../domain/markdown/parser';
import { findWikiLinkSpans } from '../domain/markdown/wikiLinks';
import type { ParsedFile } from '../domain/model';

/** The index of `files`, keyed by path. */
function indexOf(...files: ParsedFile[]) {
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

const HOWTO = [
  '# How to link #docs',
  'Write `[[Note name]]` to link a note, or ``[[Atlas]]`` for this one.',
  '',
  '```',
  '[[Atlas]]',
  '[[Fenced example]]',
  '```',
  '',
  'The real one: [[Atlas]].',
].join('\n');

suite('Links in code are examples', () => {
  test('finds the links outside fenced code and inline code spans, where they sit', () => {
    assert.deepStrictEqual(findWikiLinkSpans(HOWTO), [
      { line: 8, startColumn: 14, endColumn: 23, target: 'Atlas' },
    ]);
    assert.deepStrictEqual(
      findWikiLinkSpans('A `code` span, then [[Plan|the plan]] and ![[diagram.png]].').map((span) => span.target),
      ['Plan', 'diagram.png'],
    );
  });

  test('the parser, Linked from, the missing notes, and the link warnings all leave them out', () => {
    const howto = parseMarkdown('howto.md', HOWTO);
    const fencedOnly = parseMarkdown('fenced.md', '# Fenced\n```\n[[Atlas]]\n```\n');
    const atlas = parseMarkdown('Atlas.md', '# Atlas #project/atlas\n');
    const index = indexOf(howto, fencedOnly, atlas);

    assert.deepStrictEqual(howto.links, ['Atlas']);
    assert.deepStrictEqual(howto.sections[0].links, ['Atlas']);
    assert.deepStrictEqual(fencedOnly.links, [], 'a note that links only in a fence links nowhere');
    assert.deepStrictEqual(
      getBacklinkIndex(index).toNote('Atlas.md').map((link) => [link.sourcePath, link.line]),
      [['howto.md', 8]],
    );
    assert.deepStrictEqual(findMissingLinkTargets(index), []);
    assert.deepStrictEqual(findLinkProblems(HOWTO, index, 'howto.md'), []);
  });
});
