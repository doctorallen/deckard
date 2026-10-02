import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { WorkspaceIndex } from '../domain/model';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  countRewrittenNotes,
  findHeadingTextColumns,
  planHeadingRenameRewrites,
  planNoteRenameRewrites,
  rewriteStillFits,
} from '../domain/links/linkRewrites';
import { findHeadingAtLine } from '../domain/notes/headingLookup';

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

/** What each rewrite does, as the note reads before and after it. */
function rewritten(
  rewrites: readonly { filePath: string; from: string; text: string }[],
): string[] {
  return rewrites.map(
    (rewrite) => `${rewrite.filePath}: ${rewrite.from} -> ${rewrite.text}`,
  );
}

suite('Link rewrites', () => {
  const index = indexOf({
    'notes/Atlas.md': [
      '---',
      'aliases: [Atlas Program]',
      '---',
      '# Atlas',
      '',
      '## Decision',
      '',
      'Back to [[#Decision]] and the [[Vendor review]].',
    ].join('\n'),
    'notes/Log.md': [
      'Read [[Atlas]] and [[Atlas#Decision]] and [[Atlas#^k1|the line]].',
      'Also [[atlas]] lowercase, [[Atlas Program]] by alias.',
      '```',
      '[[Atlas]] inside a fence',
      '```',
    ].join('\n'),
    'archive/Atlas.md': '# Atlas\n\nThe old one.',
    'notes/Vendor review.md': '# Vendor review',
  });

  test('carries every link to a renamed note, keeping what was written around it', () => {
    assert.deepStrictEqual(
      rewritten(planNoteRenameRewrites(index, 'notes/Log.md', 'Journal')),
      [],
      'no link names the Log',
    );

    // Atlas is ambiguous with archive/Atlas.md, so no link resolves to it and
    // none is rewritten. A unique note is the case that matters.
    const unique = indexOf({
      'notes/Vendor review.md': '# Vendor review',
      'notes/Log.md': [
        'Read [[Vendor review]], [[Vendor review#Terms]], and',
        '[[vendor review|the review]] plus [[Vendor review#^k1]].',
        '```',
        '[[Vendor review]] inside a fence',
        '```',
      ].join('\n'),
    });
    assert.deepStrictEqual(
      rewritten(
        planNoteRenameRewrites(unique, 'notes/Vendor review.md', 'Supplier review'),
      ),
      [
        'notes/Log.md: [[Vendor review]] -> [[Supplier review]]',
        'notes/Log.md: [[Vendor review#Terms]] -> [[Supplier review#Terms]]',
        'notes/Log.md: [[vendor review|the review]] -> [[Supplier review|the review]]',
        'notes/Log.md: [[Vendor review#^k1]] -> [[Supplier review#^k1]]',
      ],
    );
  });

  test('leaves alias links, and links to the note that keeps the name, alone', () => {
    const rewrites = planNoteRenameRewrites(
      index,
      'archive/Atlas.md',
      'Atlas 2024',
    );
    assert.deepStrictEqual(
      rewritten(rewrites),
      [],
      'two notes are named Atlas, so no link resolves to either',
    );

    const aliased = indexOf({
      'notes/Atlas.md': '---\naliases: [Atlas Program]\n---\n# Atlas',
      'notes/Log.md': 'Read [[Atlas]] and [[Atlas Program]].',
    });
    assert.deepStrictEqual(
      rewritten(planNoteRenameRewrites(aliased, 'notes/Atlas.md', 'Atlas 2026')),
      ['notes/Log.md: [[Atlas]] -> [[Atlas 2026]]'],
      'the alias still resolves, so its link is left as written',
    );
  });

  test('says nothing to do when a note only moves folders', () => {
    assert.deepStrictEqual(
      planNoteRenameRewrites(index, 'notes/Vendor review.md', 'Vendor review'),
      [],
    );
  });

  test('carries the links that name a renamed heading', () => {
    const headings = indexOf({
      'notes/Atlas.md': [
        '# Atlas',
        '',
        '## Decision #project/atlas',
        '',
        'See [[#Decision]].',
      ].join('\n'),
      'notes/Log.md': [
        'Read [[Atlas#Decision]], [[Atlas#decision|the call]], and [[Atlas]].',
        'The line [[Atlas#^k1]] is not a heading.',
      ].join('\n'),
    });

    assert.deepStrictEqual(
      rewritten(
        planHeadingRenameRewrites(headings, {
          filePath: 'notes/Atlas.md',
          startLine: 3,
          from: 'Decision #project/atlas',
          to: 'Decision to sign',
        }),
      ),
      [
        'notes/Atlas.md: [[#Decision]] -> [[#Decision to sign]]',
        'notes/Log.md: [[Atlas#Decision]] -> [[Atlas#Decision to sign]]',
        'notes/Log.md: [[Atlas#decision|the call]] -> [[Atlas#Decision to sign|the call]]',
      ],
    );
  });

  test('leaves a link alone that opens another heading with the same words', () => {
    const index = indexOf({
      'Log.md': '# Log\n\n## Monday\n### Notes\nmon\n\n## Tuesday\n### Notes\ntue\n',
      'other.md': 'See [[Log#Notes]].\n',
    });
    assert.deepStrictEqual(
      planHeadingRenameRewrites(index, { filePath: 'Log.md', startLine: 8, from: 'Notes', to: 'Tuesday notes' }),
      [],
      'the link opens the first Notes, not the one renamed',
    );
    assert.deepStrictEqual(
      rewritten(planHeadingRenameRewrites(index, { filePath: 'Log.md', startLine: 4, from: 'Notes', to: 'Monday notes' })),
      ['other.md: [[Log#Notes]] -> [[Log#Monday notes]]'],
      'renaming the first Notes carries the link',
    );
  });

  test('finds the heading a line sits in', () => {
    const file = parseMarkdown(
      'notes/Atlas.md',
      '# Atlas\n\nIntro.\n\n## Decision\n\nBody.\n',
    );
    assert.strictEqual(findHeadingAtLine(file.sections, 3)?.heading, 'Atlas');
    assert.strictEqual(findHeadingAtLine(file.sections, 7)?.heading, 'Decision');
    assert.strictEqual(findHeadingAtLine([], 1), undefined);
  });

  test('a rewrite still fits only while its line holds the planned link', () => {
    const rewrite = { line: 1, startColumn: 5, endColumn: 22, from: '[[Vendor review]]' };
    const lines = ['# Log', 'Read [[Vendor review]] today.'];
    assert.strictEqual(rewriteStillFits(rewrite, lines), true);
    assert.strictEqual(rewriteStillFits(rewrite, ['# Log', 'Read [[Something]] now.']), false);
    assert.strictEqual(rewriteStillFits({ ...rewrite, line: 2 }, lines), false, 'the line is gone');
    assert.strictEqual(rewriteStillFits({ ...rewrite, startColumn: 40, endColumn: 57 }, lines), false);
  });

  test('a heading line\'s text starts after its marks; a plain line has none', () => {
    assert.deepStrictEqual(findHeadingTextColumns('## Decision'), { startColumn: 3, endColumn: 11 });
    assert.deepStrictEqual(findHeadingTextColumns('  #   Spaced  '), { startColumn: 6, endColumn: 14 });
    assert.strictEqual(findHeadingTextColumns('Decision'), undefined);
  });

  test('counts the notes a set of rewrites touches', () => {
    const at = (filePath: string) => ({ filePath, line: 0, startColumn: 0, endColumn: 1, from: '', text: '' });
    assert.strictEqual(countRewrittenNotes([at('a.md'), at('b.md'), at('a.md')]), 2);
    assert.strictEqual(countRewrittenNotes([]), 0);
  });
});
