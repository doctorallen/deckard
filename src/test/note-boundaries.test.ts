import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { NoteBoundaries } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { evaluateQuery } from '../core/query/queryEvaluator';
import { parseQuery } from '../core/query/queryParser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';

/**
 * Where one note ends and the next begins.
 *
 * A tagged line is a note of its own under `line`. Under `heading` it is not:
 * its tags stay on the line, and the heading holding the line is what a
 * search returns. Nothing is copied onto the heading, so the heading's own
 * tags stay what its author wrote there, and a match knows which line
 * answered it.
 */
suite('Note boundaries', () => {
  const NOTE = [
    '## Harbor check-in #team/harbor',
    'Sable secured a meeting with Jax and Vero together.',
    '',
    '### Sable Ortiz #person/sable-ortiz',
    '#### Consenting-witness meeting #project/argent-protocol',
    'Sable will protect the #feature/joint-summary review with #contact/jax-lumen before filing it.',
  ].join('\n');

  const parse = (boundaries: NoteBoundaries, note = NOTE) =>
    parseMarkdown('notes/check-in.md', note, undefined, {
      noteBoundaries: boundaries,
    });

  const indexOf = (boundaries: NoteBoundaries, note = NOTE): WorkspaceIndex => {
    const file = parse(boundaries, note);
    return buildWorkspaceIndex(new Map([[file.filePath, file]]));
  };

  const found = (index: WorkspaceIndex, query: string): string[] => {
    const results = evaluateQuery(index, parseQuery(query).node);
    return results.sections.map((section) => section.heading).sort();
  };

  test('a tagged line is a note of its own under "line"', () => {
    const file = parse('line');

    assert.strictEqual(file.sections.length, 4);
    const line = file.sections.find((section) => section.isInline);
    assert.ok(line, 'the sentence is an entry');
    assert.deepStrictEqual(line.tags.sort(), [
      '#contact/jax-lumen',
      '#feature/joint-summary',
    ]);
  });

  test('a tagged line is not a note of its own under "heading"', () => {
    const file = parse('heading');

    assert.strictEqual(file.sections.length, 3);
    assert.strictEqual(
      file.sections.some((section) => section.isInline),
      false,
      'nothing but headings',
    );
  });

  test('the tag stays on the line; the heading is not given it', () => {
    const file = parse('heading');
    const meeting = file.sections.find((section) =>
      section.heading.startsWith('Consenting-witness'),
    );
    assert.ok(meeting);

    // What the author wrote on the heading is still all the heading claims.
    assert.deepStrictEqual(meeting.tags, ['#project/argent-protocol']);
    // And the line's tags are recorded where they were written.
    assert.deepStrictEqual(
      (meeting.bodyTags ?? []).map((tag) => [tag.key, tag.line]).sort(),
      [
        ['#contact/jax-lumen', 6],
        ['#feature/joint-summary', 6],
      ],
    );
  });

  test('a search for a tag written in a body finds the heading holding it', () => {
    const asLines = indexOf('line');
    const asHeadings = indexOf('heading');

    assert.deepStrictEqual(
      found(asLines, '#feature/joint-summary'),
      ['Sable will protect the #feature/joint-summary review with #contact/jax-lumen before filing it.'],
      'today it is the sentence',
    );
    assert.deepStrictEqual(
      found(asHeadings, '#feature/joint-summary'),
      ['Consenting-witness meeting #project/argent-protocol'],
      'and now it is the meeting the sentence is about',
    );
  });

  test('a tag written in a body does not reach the headings above it', () => {
    const index = indexOf('heading');

    // The meeting contains the line. Its ancestors contain the meeting, not
    // the line, so promotion stops at one step and never climbs.
    assert.deepStrictEqual(found(index, '#feature/joint-summary'), [
      'Consenting-witness meeting #project/argent-protocol',
    ]);
  });

  test('a tag written in a body does not reach the lines beside it', () => {
    const index = indexOf(
      'heading',
      [
        '## Governance #risk/fatigue',
        'Reviewed with #person/orion-pike this week.',
        '',
        '### Rest rules #risk/coercion',
        'Nothing about anybody in particular.',
      ].join('\n'),
    );

    // Orion is named under Governance, not under Rest rules, and a heading
    // never hands a tag down to its children.
    assert.deepStrictEqual(found(index, '#person/orion-pike'), [
      'Governance #risk/fatigue',
    ]);
  });

  test('a heading still hands its own tags down, as it always has', () => {
    const index = indexOf('heading');

    assert.deepStrictEqual(found(index, '#team/harbor').sort(), [
      'Consenting-witness meeting #project/argent-protocol',
      'Harbor check-in #team/harbor',
      'Sable Ortiz #person/sable-ortiz',
    ]);
  });

  test('a tagged line with no heading above it stays a note', () => {
    const file = parse(
      'heading',
      'Loose prose about #project/atlas with no heading anywhere.',
    );

    assert.strictEqual(file.sections.length, 1);
    assert.strictEqual(file.sections[0].isInline, true);
    assert.deepStrictEqual(file.sections[0].tags, ['#project/atlas']);
  });

  test('a marked line stays a note of its own under "marked"', () => {
    const note = [
      '## Check-in #team/harbor',
      'An ordinary tagged line about #project/atlas.',
      '',
      'A line worth pointing at about #risk/vendor. ^vendor-call',
    ].join('\n');

    const heading = parse('heading', note);
    assert.strictEqual(
      heading.sections.filter((section) => section.isInline).length,
      0,
      'heading folds both lines',
    );

    const marked = parse('marked', note);
    const kept = marked.sections.filter((section) => section.isInline);
    assert.strictEqual(kept.length, 1, 'only the marked line stays');
    assert.deepStrictEqual(kept[0].tags, ['#risk/vendor']);

    // The unmarked line still answers for its heading.
    const index = buildWorkspaceIndex(new Map([[marked.filePath, marked]]));
    assert.deepStrictEqual(found(index, '#project/atlas'), [
      'Check-in #team/harbor',
    ]);
  });

  test('a marker anywhere in a wrapped explanation marks the whole of it', () => {
    // Consecutive tagged lines are read as one entry, so that a wrapped
    // explanation is not torn into duplicates. A marker on any of its lines
    // is therefore a marker on the entry they form.
    const marked = parse(
      'marked',
      [
        '## Check-in #team/harbor',
        'An ordinary tagged line about #project/atlas.',
        'and its wrapped continuation about #risk/vendor. ^vendor-call',
      ].join('\n'),
    );

    const kept = marked.sections.filter((section) => section.isInline);
    assert.strictEqual(kept.length, 1);
    assert.deepStrictEqual(kept[0].tags.sort(), [
      '#project/atlas',
      '#risk/vendor',
    ]);
  });

  test('the tags of one line stay one group, so "written together" holds', () => {
    const file = parse('heading');
    const meeting = file.sections.find((section) =>
      section.heading.startsWith('Consenting-witness'),
    );

    const groups = (meeting?.associationTagGroups ?? []).map((group) =>
      group.map((tag) => tag.key).sort(),
    );
    assert.deepStrictEqual(groups, [
      ['#project/argent-protocol'],
      ['#contact/jax-lumen', '#feature/joint-summary'],
    ]);
  });

  test('a heading\'s own text stops at the next heading of any level', () => {
    const file = parse('line');
    const check = file.sections.find((section) =>
      section.heading.startsWith('Harbor'),
    );
    assert.ok(check);

    // The subtree is still there for Extract to move…
    assert.match(check.rawContent, /Consenting-witness/);
    assert.strictEqual(check.endLine, 6);
    // …but the check-in's own text is its own two lines, so one sentence no
    // longer sits inside the stored text of four entries.
    assert.strictEqual(check.bodyEndLine, 3);
    assert.doesNotMatch(check.bodyContent, /Consenting-witness/);
    assert.match(check.bodyContent, /Sable secured a meeting/);
  });

  test('an old setting is read as the boundary that matches it', () => {
    // `parseInlineTags: false` dropped a line's tags entirely. Read as
    // `heading`, they keep answering, through the heading that holds them.
    const file = parseMarkdown('notes/check-in.md', NOTE, undefined, {
      parseInlineTags: false,
    });
    const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));

    assert.strictEqual(
      file.sections.some((section) => section.isInline),
      false,
    );
    assert.deepStrictEqual(found(index, '#feature/joint-summary'), [
      'Consenting-witness meeting #project/argent-protocol',
    ]);
  });
});
