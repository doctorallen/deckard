import * as assert from 'assert';

import {
  extractHeadingTagSpans,
  extractTagSpans,
  extractTags,
  extractWikiLinks,
  getEntityNamespaceAliases,
  getEntityKind,
  parseMarkdown,
  stripTags,
} from '../core/markdown/parser';

suite('Markdown parser', () => {
  test('keeps people and hash tags distinct while preserving display labels', () => {
    assert.deepStrictEqual(extractTags('Investigate @Case #case #other'), [
      { key: '@case', label: '@Case' },
      { key: '#case', label: '#case' },
      { key: '#other', label: '#other' },
    ]);
  });

  test('ignores tags made only of numbers', () => {
    assert.deepStrictEqual(extractTags('#3 #42 @3 #3d #2-step #release'), [
      { key: '@3', label: '@3' },
      { key: '#3d', label: '#3d' },
      { key: '#2-step', label: '#2-step' },
      { key: '#release', label: '#release' },
    ]);
    assert.strictEqual(stripTags('Use #3, @3, and #release'), 'Use #3, , and');

    const parsed = parseMarkdown(
      'notes/numbered.md',
      '# Heading #3 #work\n\n- [ ] Task #42 @3 #todo',
    );
    assert.deepStrictEqual(parsed.sections[0].tags, ['#work']);
    assert.deepStrictEqual(parsed.tasks[0].tags, ['#work', '@3', '#todo']);
    assert.deepStrictEqual(
      extractTagSpans('#3 @3 #work').map((span) => span.key),
      ['@3', '#work'],
    );
  });

  test('parses namespaced entities, Wiki links, and explicit task dates', () => {
    const parsed = parseMarkdown(
      'atlas.md',
      [
        '# Atlas #project/atlas @alex-smith',
        'See [[Planning Notes|Q3 plan]].',
        '- [ ] Send the proposal by 2026-09-12 #project/atlas',
      ].join('\n'),
    );

    assert.deepStrictEqual(parsed.sections[0].tags, [
      '#project/atlas',
      '@alex-smith',
    ]);
    assert.deepStrictEqual(parsed.links, ['Planning Notes']);
    assert.deepStrictEqual(extractWikiLinks('[[Atlas]] and [[People|Team]]'), [
      'Atlas',
      'People',
    ]);
    assert.strictEqual(
      getEntityKind({ key: '#project/atlas', label: '#project/atlas' }),
      'project',
    );
    assert.strictEqual(
      getEntityKind({ key: '@alex-smith', label: '@alex-smith' }),
      'person',
    );
    assert.strictEqual(parsed.tasks[0].dueText, '2026-09-12');
  });

  test('normalizes configured entity namespace aliases', () => {
    const aliases = getEntityNamespaceAliases({
      proj: 'project',
      client: 'organization',
    });
    const parsed = parseMarkdown(
      'atlas.md',
      '# Atlas #proj/atlas #client/acme',
      undefined,
      { entityNamespaceAliases: aliases },
    );

    assert.deepStrictEqual(parsed.sections[0].tags, [
      '#project/atlas',
      '#org/acme',
    ]);
    assert.deepStrictEqual(
      extractTagSpans('# Atlas #proj/atlas', true, aliases).map(
        (span) => span.key,
      ),
      ['#project/atlas'],
    );
    assert.strictEqual(
      getEntityKind({ key: '#client/acme', label: '#client/acme' }, aliases),
      'organization',
    );
  });

  test('uses the configured people marker and preserves @ as a generic tag', () => {
    const parsed = parseMarkdown(
      'team.md',
      '# Team ~mara-vale @inbox',
      undefined,
      { personMarker: '~' },
    );

    assert.deepStrictEqual(parsed.sections[0].tags, [
      '@mara-vale',
      '#tag-at/inbox',
    ]);
    assert.strictEqual(
      getEntityKind({ key: '#tag-at/inbox', label: '@inbox' }),
      undefined,
    );
    assert.deepStrictEqual(
      extractTagSpans('# Team ~mara-vale @inbox', true, undefined, '~').map(
        (span) => ({ key: span.key, label: span.label }),
      ),
      [
        { key: '@mara-vale', label: '~mara-vale' },
        { key: '#tag-at/inbox', label: '@inbox' },
      ],
    );
    assert.strictEqual(stripTags('Team ~mara-vale @inbox', '~'), 'Team');
  });

  test('inherits supported frontmatter entities into sections and tasks', () => {
    const parsed = parseMarkdown(
      'atlas.md',
      [
        '---',
        'project: Atlas',
        'people: [Alex Smith]',
        'topics:',
        '  - Leadership',
        '---',
        '# Notes',
        '- [ ] Follow up',
      ].join('\n'),
    );

    assert.deepStrictEqual(parsed.sections[0].tags, [
      '#project/atlas',
      '@alex-smith',
      '#topic/leadership',
    ]);
    assert.strictEqual(parsed.sections.length, 1);
    assert.deepStrictEqual(parsed.tasks[0].tags, [
      '#project/atlas',
      '@alex-smith',
      '#topic/leadership',
    ]);
  });

  test('returns typed clickable spans for supported frontmatter values', () => {
    const spans = extractTagSpans(
      [
        '---',
        'projects: [neon-relay, relay-protocol]',
        'people:',
        '  - mara-vale',
        'topics: signal-integrity',
        'draft: true',
        '---',
        '# Notes',
      ].join('\n'),
      false,
    );

    assert.deepStrictEqual(spans, [
      {
        key: '#project/neon-relay',
        label: '#project/neon-relay',
        lineNumber: 2,
        startColumn: 11,
        endColumn: 21,
      },
      {
        key: '#project/relay-protocol',
        label: '#project/relay-protocol',
        lineNumber: 2,
        startColumn: 23,
        endColumn: 37,
      },
      {
        key: '@mara-vale',
        label: '@mara-vale',
        lineNumber: 4,
        startColumn: 4,
        endColumn: 13,
      },
      {
        key: '#topic/signal-integrity',
        label: '#topic/signal-integrity',
        lineNumber: 5,
        startColumn: 8,
        endColumn: 24,
      },
    ]);
  });

  test('anchors common task dates to the saved note year', () => {
    const parsed = parseMarkdown(
      'atlas.md',
      '- [ ] Schedule review Sep 12',
      { updatedAt: new Date(2026, 0, 1).getTime() },
    );

    assert.strictEqual(
      new Date(parsed.tasks[0].dueAt ?? 0).getMonth(),
      8,
    );
    assert.strictEqual(
      new Date(parsed.tasks[0].dueAt ?? 0).getFullYear(),
      2026,
    );
  });

  test('indexes nested sections with exact ranges and inherited task tags', () => {
    const parsed = parseMarkdown(
      'notes/investigation.md',
      [
        '# Case File @investigation',
        '',
        '- [ ] Review evidence #urgent',
        '',
        '## Lead #clue',
        'Notes about the lead.',
        '',
        '## Closed',
        '- [x] Archive record',
        '',
        '# Next Case',
        'End.',
      ].join('\n'),
    );

    assert.strictEqual(parsed.sections.length, 4);
    assert.deepStrictEqual(parsed.sections[0].tags, ['@investigation']);
    assert.strictEqual(parsed.sections[0].startLine, 1);
    assert.strictEqual(parsed.sections[0].endLine, 10);
    assert.strictEqual(parsed.sections[1].startLine, 5);
    assert.strictEqual(parsed.sections[1].endLine, 7);
    assert.deepStrictEqual(parsed.sections[1].tags, ['#clue']);

    assert.strictEqual(parsed.tasks.length, 2);
    assert.deepStrictEqual(parsed.tasks[0].tags, ['@investigation', '#urgent']);
    assert.strictEqual(parsed.tasks[0].completed, false);
    assert.strictEqual(parsed.tasks[0].lineNumber, 3);
    assert.strictEqual(parsed.tasks[0].checkboxColumn, 3);
    assert.strictEqual(parsed.tasks[1].completed, true);
    assert.strictEqual(parsed.tasks[1].sectionId, parsed.sections[2].id);
  });

  test('handles empty content and tasks before the first heading', () => {
    const parsed = parseMarkdown('notes/loose.md', '- [X] Unfiled task @inbox');

    assert.deepStrictEqual(parsed.sections, []);
    assert.strictEqual(parsed.tasks.length, 1);
    assert.strictEqual(parsed.tasks[0].sectionId, undefined);
    assert.deepStrictEqual(parsed.tasks[0].tags, ['@inbox']);
  });

  test('indexes tagged non-heading lines as standalone entries by default', () => {
    const parsed = parseMarkdown(
      'notes/inline.md',
      [
        '# Case #heading',
        'An inline entry #detail',
        'The rest of the section.',
        '- [ ] Task #task',
        '```markdown',
        'Code sample #ignored',
        '```',
      ].join('\n'),
    );

    assert.strictEqual(parsed.sections.length, 2);
    assert.deepStrictEqual(
      parsed.sections.map((section) => section.heading),
      ['Case #heading', 'An inline entry #detail'],
    );
    assert.strictEqual(parsed.sections[1].isInline, true);
    assert.strictEqual(parsed.sections[1].startLine, 2);
    assert.strictEqual(parsed.sections[1].endLine, 2);
    assert.deepStrictEqual(parsed.sections[1].tags, ['#detail']);
    assert.deepStrictEqual(parsed.tasks[0].tags, ['#heading', '#task']);
    assert.strictEqual(
      parsed.sections.some((section) => section.tags.includes('ignored')),
      false,
    );
  });

  test('can disable standalone inline tag entries', () => {
    const parsed = parseMarkdown(
      'notes/inline-disabled.md',
      '# Case #heading\nInline entry #detail\n- [ ] Task #task',
      undefined,
      { parseInlineTags: false },
    );

    assert.strictEqual(parsed.sections.length, 1);
    assert.deepStrictEqual(parsed.sections[0].tags, ['#heading']);
    assert.deepStrictEqual(parsed.tasks[0].tags, ['#heading', '#task']);
  });

  test('ignores headings and checklist examples inside fenced code', () => {
    const parsed = parseMarkdown(
      'notes/code.md',
      [
        '# Real @actual',
        '',
        '```markdown',
        '# Not a section @fake',
        '- [ ] Not a task',
        '```',
        '',
        '- [ ] Real task',
      ].join('\n'),
    );

    assert.strictEqual(parsed.sections.length, 1);
    assert.strictEqual(parsed.tasks.length, 1);
    assert.strictEqual(parsed.tasks[0].title, 'Real task');
  });

  test('returns clickable tag spans for real headings only', () => {
    const spans = extractHeadingTagSpans(
      ['# Case @Work #urgent', '```', '# Fake @ignored', '```'].join('\n'),
    );

    assert.deepStrictEqual(spans, [
      {
        key: '@work',
        label: '@Work',
        lineNumber: 1,
        startColumn: 7,
        endColumn: 12,
      },
      {
        key: '#urgent',
        label: '#urgent',
        lineNumber: 1,
        startColumn: 13,
        endColumn: 20,
      },
    ]);
  });
});
