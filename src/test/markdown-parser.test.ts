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

  test('links inline tagged entries to their containing heading ancestry', () => {
    const parsed = parseMarkdown(
      'inline-ancestry.md',
      [
        '## Harbor check-in #team/harbor',
        '### Sable Ortiz #person/sable-ortiz',
        '#### Clinic-source protection #project/vesper-nine',
        'Sable will keep #contact/miko-tern separate from #feature/source-protection.',
      ].join('\n'),
    );

    const harbor = parsed.sections.find((section) =>
      section.heading.startsWith('Harbor check-in'),
    );
    const sable = parsed.sections.find((section) =>
      section.heading.startsWith('Sable Ortiz'),
    );
    const clinic = parsed.sections.find((section) =>
      section.heading.startsWith('Clinic-source protection'),
    );
    const inline = parsed.sections.find((section) => section.isInline);

    assert.ok(harbor);
    assert.ok(sable);
    assert.ok(clinic);
    assert.ok(inline);
    assert.strictEqual(inline.parentSectionId, clinic.id);
    assert.strictEqual(clinic.parentSectionId, sable.id);
    assert.strictEqual(sable.parentSectionId, harbor.id);
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

  test('reads other names for a note from aliases front matter', () => {
    const inline = parseMarkdown(
      'notes/atlas.md',
      '---\naliases: [Atlas Program, "AP"]\ntags: [planning]\n---\n# Atlas',
    );
    assert.deepStrictEqual(inline.aliases, ['Atlas Program', 'AP']);
    assert.deepStrictEqual(
      inline.frontmatterTags.map((tag) => tag.key),
      ['#planning'],
      'aliases are not tags',
    );

    const listed = parseMarkdown(
      'notes/atlas.md',
      '---\naliases:\n  - Atlas Program\n  - AP\nalias: Atlas\n---\n',
    );
    assert.deepStrictEqual(listed.aliases, ['Atlas Program', 'AP', 'Atlas']);
    assert.strictEqual(parseMarkdown('notes/atlas.md', '# Atlas').aliases, undefined);
  });

  test("takes a note's created and updated dates from the note before its file", () => {
    // A clone gives every file the same, later times.
    const cloned = {
      createdAt: new Date(2027, 2, 3).getTime(),
      updatedAt: new Date(2027, 2, 4).getTime(),
    };
    const dayOf = (value: number | undefined) => new Date(value ?? 0).toDateString();
    const on = (year: number, month: number, date: number) =>
      new Date(year, month, date).toDateString();

    const stated = parseMarkdown(
      'atlas.md',
      '---\ncreated: 2026-05-01\nupdated: 2026-06-02\n---\n# Atlas\n- [ ] Plan',
      cloned,
    );
    assert.strictEqual(dayOf(stated.createdAt), on(2026, 4, 1));
    assert.strictEqual(dayOf(stated.updatedAt), on(2026, 5, 2));
    assert.strictEqual(dayOf(stated.sections[0].createdAt), on(2026, 4, 1));
    assert.strictEqual(dayOf(stated.tasks[0].updatedAt), on(2026, 5, 2));
    assert.deepStrictEqual(stated.fileTimes, cloned, 'the file times are kept');

    const dated = parseMarkdown('atlas.md', '---\ndate: 2026-05-01\n---\n# Atlas', cloned);
    assert.strictEqual(dayOf(dated.createdAt), on(2026, 4, 1));
    assert.strictEqual(dated.updatedAt, cloned.updatedAt, 'date: is not an update');

    const daily = parseMarkdown('journal/2026-08-25.md', '# Planning', cloned);
    assert.strictEqual(dayOf(daily.createdAt), on(2026, 7, 25), 'a clone never moves it past its day');
    assert.strictEqual(daily.updatedAt, cloned.updatedAt);

    const planned = parseMarkdown('journal/2026-08-25.md', '# Planning', {
      createdAt: new Date(2026, 7, 20).getTime(),
      updatedAt: new Date(2026, 7, 26).getTime(),
    });
    assert.strictEqual(dayOf(planned.createdAt), on(2026, 7, 20), 'a plan written ahead keeps its own day');

    const plain = parseMarkdown('atlas.md', '# Atlas', cloned);
    assert.strictEqual(plain.createdAt, cloned.createdAt);
    assert.strictEqual(plain.updatedAt, cloned.updatedAt);
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

  test('reads loose task dates from the day a daily note is for', () => {
    // Saved long afterwards, as after editing an old note or cloning the
    // repository, which must not move its dates.
    const edited = { updatedAt: new Date(2027, 2, 3).getTime() };
    const friday = new Date(2026, 7, 28).toDateString();

    const fromName = parseMarkdown(
      'journal/2026-08-25.md',
      '# Planning\n- [ ] Draft the agenda next Friday\n- [ ] Book the room Sep 16',
      edited,
    );
    assert.strictEqual(new Date(fromName.tasks[0].dueAt ?? 0).toDateString(), friday);
    assert.strictEqual(new Date(fromName.tasks[1].dueAt ?? 0).getFullYear(), 2026);

    const fromHeading = parseMarkdown(
      'journal/planning.md',
      '# 2026-08-25\n- [ ] Draft the agenda next Friday',
      edited,
    );
    assert.strictEqual(new Date(fromHeading.tasks[0].dueAt ?? 0).toDateString(), friday);

    const fromFrontmatter = parseMarkdown(
      'journal/planning.md',
      '---\ndate: 2026-08-25\n---\n# Planning\n- [ ] Draft the agenda next Friday',
      edited,
    );
    assert.strictEqual(
      new Date(fromFrontmatter.tasks[0].dueAt ?? 0).toDateString(),
      friday,
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

  test('reads a hub note from describes front matter', () => {
    const parsed = parseMarkdown(
      'notes/atlas.md',
      [
        '---',
        'describes: [project/atlas, "@dana"]',
        'status: active',
        'owner: "@dana"',
        'tags: [planning]',
        '---',
        '# Atlas',
      ].join('\n'),
    );

    assert.deepStrictEqual(parsed.hub, {
      describes: [
        { key: '#project/atlas', label: '#project/atlas' },
        { key: '@dana', label: '@dana' },
      ],
      properties: [
        { name: 'status', values: [{ text: 'active' }] },
        {
          name: 'owner',
          values: [{ text: '@dana', tag: { key: '@dana', label: '@dana' } }],
        },
      ],
    });
    // The hub carries what it describes, so it belongs to that overview.
    assert.ok(parsed.sections[0].tags.includes('#project/atlas'));
    assert.strictEqual(
      parseMarkdown('notes/plain.md', '---\ntags: [atlas]\n---\n# Plain').hub,
      undefined,
    );
  });
});
