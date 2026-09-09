import * as assert from 'assert';

import {
  extractHeadingTagSpans,
  extractTagSpans,
  extractTags,
  formatEntityTitle,
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
    assert.strictEqual(
      getEntityKind({
        key: '#management/performance',
        label: '#management/performance',
      }),
      'management',
    );
    assert.strictEqual(
      formatEntityTitle('management', 'performance'),
      'Management: Performance',
    );
    assert.strictEqual(parsed.tasks[0].dueText, '2026-09-12');
  });

  test('parses tags on H4-H6 headings without treating heading hashes as tags', () => {
    const content = [
      '## something',
      '#### Detail #h4',
      '##### Deeper #h5',
      '###### Deepest #h6',
    ].join('\n');
    const parsed = parseMarkdown('headings.md', content);

    assert.deepStrictEqual(
      parsed.sections.map((section) => section.heading),
      ['something', 'Detail #h4', 'Deeper #h5', 'Deepest #h6'],
    );
    assert.deepStrictEqual(
      parsed.sections.map((section) => section.tags),
      [[], ['#h4'], ['#h5'], ['#h6']],
    );
    assert.deepStrictEqual(
      extractHeadingTagSpans(content).map((span) => ({
        key: span.key,
        lineNumber: span.lineNumber,
      })),
      [
        { key: '#h4', lineNumber: 2 },
        { key: '#h5', lineNumber: 3 },
        { key: '#h6', lineNumber: 4 },
      ],
    );
    assert.deepStrictEqual(extractTags('## something'), []);
    assert.deepStrictEqual(extractTags('##something'), []);
    assert.deepStrictEqual(
      parseMarkdown('not-a-heading.md', '##something').sections,
      [],
    );
  });

  test('supports a heading whose title is only a tag', () => {
    const content = '#### #SDLC';
    const parsed = parseMarkdown('tag-heading.md', content);

    assert.strictEqual(parsed.sections.length, 1);
    assert.strictEqual(parsed.sections[0].heading, '#SDLC');
    assert.strictEqual(parsed.sections[0].headingLevel, 4);
    assert.deepStrictEqual(parsed.sections[0].tags, ['#sdlc']);
    assert.deepStrictEqual(parsed.sections[0].tagLabels, {
      '#sdlc': '#SDLC',
    });
    assert.deepStrictEqual(extractHeadingTagSpans(content), [
      {
        key: '#sdlc',
        label: '#SDLC',
        lineNumber: 1,
        startColumn: 5,
        endColumn: 10,
      },
    ]);
  });

  test('tracks explicit heading tags separately from structural ancestors', () => {
    const parsed = parseMarkdown(
      'heading-relationships.md',
      [
        '# Relay map #parent',
        '## Untagged operating notes',
        '### Signal route #child',
        '## Alternate route #sibling',
      ].join('\n'),
    );

    const [parent, intermediate, child, sibling] = parsed.sections;
    assert.deepStrictEqual(parent.headingTags, [
      { key: '#parent', label: '#parent' },
    ]);
    assert.deepStrictEqual(intermediate.headingTags, []);
    assert.deepStrictEqual(child.headingTags, [
      { key: '#child', label: '#child' },
    ]);
    assert.strictEqual(parent.parentSectionId, undefined);
    assert.strictEqual(intermediate.parentSectionId, parent.id);
    assert.strictEqual(child.parentSectionId, intermediate.id);
    assert.strictEqual(sibling.parentSectionId, parent.id);
  });

  test('normalizes configured entity namespace aliases', () => {
    const aliases = getEntityNamespaceAliases({
      proj: 'project',
      client: 'organization',
      leadership: 'management',
      operations: 'management',
    });
    const parsed = parseMarkdown(
      'atlas.md',
      '# Atlas #proj/atlas #client/acme #leadership/performance #operations/performance #management/performance',
      undefined,
      { entityNamespaceAliases: aliases },
    );

    assert.deepStrictEqual(parsed.sections[0].tags, [
      '#project/atlas',
      '#org/acme',
      '#management/performance',
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
    assert.strictEqual(
      getEntityKind(
        { key: '#leadership/performance', label: '#leadership/performance' },
        aliases,
      ),
      'management',
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

  test('keeps custom namespaced tags when they come from tag frontmatter', () => {
    const parsed = parseMarkdown(
      'management.md',
      [
        '---',
        'tags: [management/performance]',
        '---',
        '# Review',
      ].join('\n'),
    );

    assert.deepStrictEqual(parsed.sections[0].tags, [
      '#management/performance',
    ]);
    assert.strictEqual(
      getEntityKind({
        key: '#management/performance',
        label: '#management/performance',
      }),
      'management',
    );
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

  test('groups consecutive tagged prose lines into one inline entry', () => {
    const parsed = parseMarkdown(
      'notes/inline-paragraph.md',
      [
        '# Tag reference',
        '#project/neon-relay is a project. #topic/synthetic-memory is a topic.',
        '#org/lumen-transit is an organization. #meeting/sector-nine-briefing is a',
        'meeting. Ordinary labels such as #follow-up remain lightweight tags.',
        '',
        '# Next section',
      ].join('\n'),
    );

    const inline = parsed.sections.find((section) => section.isInline);
    assert.ok(inline);
    assert.strictEqual(inline.heading, '#project/neon-relay is a project. #topic/synthetic-memory is a topic.');
    assert.strictEqual(inline.startLine, 2);
    assert.strictEqual(inline.endLine, 4);
    assert.strictEqual(
      inline.rawContent,
      [
        '#project/neon-relay is a project. #topic/synthetic-memory is a topic.',
        '#org/lumen-transit is an organization. #meeting/sector-nine-briefing is a',
        'meeting. Ordinary labels such as #follow-up remain lightweight tags.',
      ].join('\n'),
    );
    assert.deepStrictEqual(inline.tags, [
      '#project/neon-relay',
      '#topic/synthetic-memory',
      '#org/lumen-transit',
      '#meeting/sector-nine-briefing',
      '#follow-up',
    ]);
  });

  test('keeps tagged numbered list items independent', () => {
    const parsed = parseMarkdown(
      'notes/numbered-list.md',
      [
        '# Escalation ladder',
        '1. @ivo-chen verifies the physical junction.',
        '2. @mara-vale approves an operational exception.',
        '3. Lumen Transit control records the final decision.',
      ].join('\n'),
    );

    assert.deepStrictEqual(
      parsed.sections.map((section) => section.heading),
      [
        'Escalation ladder',
        '1. @ivo-chen verifies the physical junction.',
        '2. @mara-vale approves an operational exception.',
      ],
    );
    assert.deepStrictEqual(
      parsed.sections.slice(1).map((section) => [section.startLine, section.endLine]),
      [
        [2, 2],
        [3, 3],
      ],
    );
    assert.deepStrictEqual(parsed.sections.slice(1).map((section) => section.tags), [
      ['@ivo-chen'],
      ['@mara-vale'],
    ]);
  });

  test('includes nested bullets under a tagged list item', () => {
    const content = [
      '# Night route',
      '- #project/east-junction',
      '  - Finishing the relay inspection.',
      '  - Moving the patrol to the abandoned platform.',
      '  - [ ] Verify the floodwall sensor.',
      '- #project/neon-relay',
      '  - Keep this sibling entry separate.',
    ].join('\n');
    const parsed = parseMarkdown('notes/list-items.md', content);
    const eastJunction = parsed.sections.find((section) =>
      section.tags.includes('#project/east-junction'),
    );

    assert.ok(eastJunction);
    assert.strictEqual(eastJunction.isInline, true);
    assert.strictEqual(eastJunction.startLine, 2);
    assert.strictEqual(eastJunction.endLine, 5);
    assert.strictEqual(
      eastJunction.rawContent,
      [
        '- #project/east-junction',
        '  - Finishing the relay inspection.',
        '  - Moving the patrol to the abandoned platform.',
        '  - [ ] Verify the floodwall sensor.',
      ].join('\n'),
    );
    assert.strictEqual(parsed.tasks[0].sectionId, eastJunction.id);
    assert.deepStrictEqual(parsed.tasks[0].tags, ['#project/east-junction']);

    const neonRelay = parsed.sections.find((section) =>
      section.tags.includes('#project/neon-relay'),
    );
    assert.ok(neonRelay);
    assert.strictEqual(neonRelay.startLine, 6);
    assert.strictEqual(neonRelay.endLine, 7);
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
