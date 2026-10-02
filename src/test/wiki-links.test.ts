import * as assert from 'assert';

import { findMissingLinkTargets, getBacklinkIndex, parseWikiTarget } from '../domain/index/backlinks';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { findLinkProblems } from '../domain/links/linkProblems';
import { getExtractedNoteFileName } from '../domain/markdown/noteNames';
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

suite('Links that name a file rather than a note title', () => {
  test('[[Plan.md]] opens Plan, and a note created for [[Atlas.md]] answers it', () => {
    const howto = parseMarkdown('notes/howto.md', '# How\nSee [[Plan.md]], [[plan.MD#Goals]], and [[Atlas.md]].\n');
    const plan = parseMarkdown('notes/Plan.md', '# Plan\n## Goals\n');
    const index = indexOf(howto, plan);
    assert.deepStrictEqual(parseWikiTarget('Plan.md'), { note: 'Plan' });
    assert.deepStrictEqual(parseWikiTarget('plan.MD#Goals'), { note: 'plan', heading: 'Goals' });
    assert.deepStrictEqual(getBacklinkIndex(index).toNote('notes/Plan.md').length, 2);
    assert.deepStrictEqual(findMissingLinkTargets(index).map((target) => target.name), ['Atlas']);

    const content = howto.content;
    const [problem] = findLinkProblems(content, index, 'notes/howto.md');
    assert.strictEqual(problem.name, 'Atlas');
    const created = getExtractedNoteFileName(problem.name);
    assert.strictEqual(created, 'Atlas.md');
    const withAtlas = indexOf(howto, plan, parseMarkdown(`notes/${created}`, '# Atlas\n'));
    assert.deepStrictEqual(findLinkProblems(content, withAtlas, 'notes/howto.md'), [], 'the created note clears the warning');
  });

  test('an embedded image or a linked attachment is not a missing note', () => {
    const architecture = parseMarkdown(
      'notes/architecture.md',
      '# Architecture\n![[diagram.png]]\nThe [[spec.pdf|specification]] and [[Missing note]].\n',
    );
    const index = indexOf(architecture);
    assert.deepStrictEqual(findMissingLinkTargets(index).map((target) => target.name), ['Missing note']);
    assert.deepStrictEqual(
      findLinkProblems(architecture.content, index, 'notes/architecture.md').map((problem) => problem.name),
      ['Missing note'],
    );
  });
});
