import * as assert from 'assert';

import { parseMarkdown, type NoteBoundaries } from '../domain/markdown/parser';
import { entryIdOf, entryText, fileEntryId, groupEntryParts, isEntrySection } from '../domain/markdown/noteEntries';
import type { ParsedFile } from '../domain/model';
import { buildWorkspaceIndex } from '../domain/index/indexState';

/**
 * Which note each heading, tagged line, and task belongs to: a heading with
 * tags of its own owns the untagged headings under it, down to a heading
 * with tags of its own (docs/implementation/24-note-entries.md).
 */
suite('Note entries: what each heading belongs to', () => {
  const ADR = [
    '# ADR-001 Card form #decision #project/checkout-v2',
    'Date: 2026-09-25',
    '',
    '## Context',
    'The old checkout built its own card fields.',
    '',
    '## Decision #decision/accepted',
    'Use the hosted card fields.',
    '### Rationale',
    'Card data never reaches our servers.',
    '',
    '## Consequences',
    '- [ ] Map the provider\'s errors',
  ].join('\n');

  const parse = (content: string, boundaries: NoteBoundaries = 'line', path = 'decisions/adr.md'): ParsedFile =>
    parseMarkdown(path, content, undefined, { noteBoundaries: boundaries });
  const owners = (file: ParsedFile): Record<string, string> =>
    Object.fromEntries(file.sections.map((section) => [section.heading, entryIdOf(section) === section.id ? 'self' : headingOf(file, entryIdOf(section))]));
  const headingOf = (file: ParsedFile, id: string): string =>
    id.startsWith('file:') ? 'file' : file.sections.find((section) => section.id === id)?.heading ?? id;

  test('an untagged heading belongs to the tagged heading above it, and a tagged one is its own note', () => {
    const file = parse(ADR);
    assert.deepStrictEqual(owners(file), {
      'ADR-001 Card form #decision #project/checkout-v2': 'self',
      Context: 'ADR-001 Card form #decision #project/checkout-v2',
      'Decision #decision/accepted': 'self',
      Rationale: 'Decision #decision/accepted',
      Consequences: 'ADR-001 Card form #decision #project/checkout-v2',
    });
    assert.deepStrictEqual(file.sections.filter(isEntrySection).length, 2);
  });

  test('an entry reads through what it owns, in order, and skips a heading with tags of its own', () => {
    const file = parse(ADR);
    const parts = groupEntryParts(file.sections);
    const adr = file.sections[0];
    const text = entryText(parts.get(adr.id), adr);
    assert.match(text, /Date: 2026-09-25/);
    assert.match(text, /## Context\nThe old checkout/);
    assert.match(text, /## Consequences/);
    assert.ok(!text.includes('hosted card fields'), 'the Decision is a note of its own');
  });

  test('a task belongs to the entry that owns its heading', () => {
    const file = parse(ADR);
    const task = file.tasks[0];
    assert.strictEqual(task.entryId, file.sections[0].id);
  });

  test('a note tagged in its front matter is one entry, past any heading with tags of its own', () => {
    const file = parse(['---', 'tags: [project/atlas]', '---', 'Intro.', '## Plan', '- [ ] Draft it', '## Risks #risk', 'Vendor.'].join('\n'), 'line', 'notes/atlas.md');
    assert.deepStrictEqual(owners(file), { Plan: 'file', 'Risks #risk': 'self' });
    assert.strictEqual(file.tasks[0].entryId, fileEntryId('notes/atlas.md'));
  });

  test('where no tag reaches, each heading is its own note, as before', () => {
    const file = parse(['# Journal', '## Monday', 'Lift is stuck.', '## Tuesday', 'Fixed.'].join('\n'), 'line', 'notes/journal.md');
    assert.ok(file.sections.every(isEntrySection));
    assert.ok(file.tasks.every((task) => task.entryId === undefined));
  });

  test('a tagged line stands as its own note under line, and folds into the owner under heading', () => {
    const note = ['# Plan #project/atlas', '## Notes', 'Ask #person/dana about the lift.'].join('\n');
    const byLine = parse(note, 'line');
    const inline = byLine.sections.find((section) => section.isInline);
    assert.ok(inline && isEntrySection(inline), 'under line, the tagged line is a note');
    const byHeading = parse(note, 'heading');
    assert.ok(!byHeading.sections.some((section) => section.isInline));
    const notes = byHeading.sections.find((section) => section.heading === 'Notes');
    assert.strictEqual(notes && entryIdOf(notes), byHeading.sections[0].id, 'under heading, its heading belongs to the plan');
    assert.ok(notes?.bodyTags?.some((tag) => tag.key === '#person/dana'), 'the tag stays on the line');
  });

  test('the index counts a note once: a tag lists the entry that owns it, and a task inside it adds nothing', () => {
    const file = parse(ADR);
    const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
    const tag = index.tags.get('#project/checkout-v2');
    assert.deepStrictEqual(tag?.sectionIds, [file.sections[0].id]);
    assert.strictEqual(tag?.count, 1, 'the task under Consequences belongs to the ADR');
  });

  test('a note tagged in its front matter is a member as a file, beside its headings with tags of their own', () => {
    const file = parse(['---', 'tags: [project/atlas]', '---', 'Intro.', '## Plan', '- [ ] Draft it', '## Risks #risk', 'Vendor.'].join('\n'), 'line', 'notes/atlas.md');
    const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
    const tag = index.tags.get('#project/atlas');
    assert.deepStrictEqual(tag?.filePaths, ['notes/atlas.md']);
    assert.deepStrictEqual(tag?.sectionIds, [file.sections.find((section) => section.heading.startsWith('Risks'))?.id]);
    assert.strictEqual(tag?.count, 2, 'the note and its Risks; the task belongs to the note');
  });
});

