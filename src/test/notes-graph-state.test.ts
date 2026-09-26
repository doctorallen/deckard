import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  createLocalGraphSnapshot,
  createNotesGraphConnections,
  createNotesGraphSnapshot,
  findNoteNodeIds,
  graphInputsChanged,
} from '../ui/state/notesGraphState';
import {
  parseNotesGraphMessage,
  parseSidebarMessage,
} from '../ui/webview/messages';
import { NotesGraphSnapshot, ParsedFile } from '../core/types';

suite('Notes graph state', () => {
  test('draws one note and what it is attached to, a hop at a time', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n\nSee [[relay]].'),
      parseMarkdown('notes/relay.md', '# Relay #project/atlas'),
      parseMarkdown('notes/far.md', '# Far away #topic/other'),
    ]);
    const focus = findNoteNodeIds(snapshot, 'notes/atlas.md');
    assert.strictEqual(focus.length, 1, 'the note is one heading');

    const titles = (depth: number): string[] =>
      createLocalGraphSnapshot(snapshot, focus, depth)
        .nodes.map((node) => node.title)
        .sort();
    assert.deepStrictEqual(
      titles(1),
      ['#project/atlas', 'Atlas', 'Relay'],
      'the note, the tag it carries, and the note it links to',
    );
    assert.ok(
      !titles(2).includes('Far away'),
      'a note sharing nothing stays out however far the graph reaches',
    );
  });

  test('passes through a daily note, joining what lies beyond it to where the path began', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/atlas.md', '# Atlas\n\nSee [[2026-09-25]].'),
      parseMarkdown('notes/2026-09-25.md', '# 2026-09-25\n\nMet about [[relay]].'),
      parseMarkdown('notes/relay.md', '# Relay'),
    ]);
    const focus = findNoteNodeIds(snapshot, 'notes/atlas.md');
    const daily = (node: { filePath?: string }) => node.filePath === 'notes/2026-09-25.md';
    const local = createLocalGraphSnapshot(snapshot, focus, 2, daily);
    assert.deepStrictEqual(local.nodes.map((node) => node.title).sort(), ['Atlas', 'Relay'], 'the daily note is not drawn');
    assert.strictEqual(local.edges.length, 1, 'what it led to is joined to the note it came from');
    assert.deepStrictEqual(
      [local.edges[0].source, local.edges[0].target].sort(),
      [...focus, ...findNoteNodeIds(snapshot, 'notes/relay.md')].sort(),
    );
  });

  test('keeps only the edges between what it kept', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/atlas.md', '# Atlas #project/atlas'),
      parseMarkdown('notes/relay.md', '# Relay #project/atlas #risk/vendor'),
      parseMarkdown('notes/vendor.md', '# Vendor #risk/vendor'),
    ]);
    // Atlas reaches Relay through the tag they share: two hops, not one.
    const local = createLocalGraphSnapshot(
      snapshot,
      findNoteNodeIds(snapshot, 'notes/atlas.md'),
      2,
    );
    const kept = new Set(local.nodes.map((node) => node.id));
    assert.ok(local.edges.length > 0);
    local.edges.forEach((edge) => {
      assert.ok(kept.has(edge.source) && kept.has(edge.target), edge.id);
    });
    assert.deepStrictEqual(
      local.tags.map(([key]) => key),
      ['#project/atlas', '#risk/vendor'],
      'the tags this neighborhood holds, a tag association being a hop like any other',
    );
    assert.strictEqual(
      local.totalNoteCount,
      2,
      'Vendor is a hop further out than this reaches',
    );
  });

  test('draws nothing for a note the graph does not hold', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/atlas.md', '# Atlas #project/atlas'),
    ]);
    assert.deepStrictEqual(findNoteNodeIds(snapshot, 'notes/gone.md'), []);
    const empty = createLocalGraphSnapshot(snapshot, [], 2);
    assert.deepStrictEqual(empty.nodes, []);
    assert.deepStrictEqual(empty.edges, []);
    assert.strictEqual(empty.totalNoteCount, 0);
  });

  test('accepts the scope a graph asks for, and no other', () => {
    assert.deepStrictEqual(
      parseNotesGraphMessage({ type: 'setGraphScope', local: true, depth: 2 }),
      { type: 'setGraphScope', local: true, depth: 2 },
    );
    for (const message of [
      { type: 'setGraphScope', local: true, depth: 0 },
      { type: 'setGraphScope', local: true, depth: 9 },
      { type: 'setGraphScope', local: true, depth: 1.5 },
      { type: 'setGraphScope', local: 'yes', depth: 1 },
    ]) {
      assert.strictEqual(
        parseNotesGraphMessage(message),
        undefined,
        JSON.stringify(message),
      );
    }
  });

  test('connects notes to a shared tag anchor', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/a.md', '# Alpha #project/atlas'),
      parseMarkdown('notes/b.md', '# Beta #project/atlas'),
    ]);

    const membership = snapshot.edges.filter((edge) =>
      edge.types.includes('tag-membership'),
    );
    assert.strictEqual(membership.length, 2);
    membership.forEach((edge) => {
      assert.ok(
        edge.source.startsWith('tag:') || edge.target.startsWith('tag:'),
      );
    });
  });

  test('keeps large tag clusters linear through one membership per note', () => {
    const files: ParsedFile[] = [];
    for (let index = 0; index < 30; index += 1) {
      files.push(
        parseMarkdown(`notes/n${index}.md`, `# Note ${index} #common`),
      );
    }
    const snapshot = buildSnapshot(files);

    const membership = snapshot.edges.filter((edge) =>
      edge.types.includes('tag-membership'),
    );
    assert.strictEqual(membership.length, 30);
    assert.strictEqual(
      snapshot.edges.some((edge) =>
        edge.types.includes('tag-membership') && edge.weight < 1,
      ),
      true,
    );
  });

  test('resolves wiki links by bare filename', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/source.md', '# Source #tag-a\n\nSee [[target]].'),
      parseMarkdown('other/target.md', '# Target heading #tag-b'),
    ]);

    const edge = findEdgeByTypes(snapshot, 'wiki-link');
    assert.ok(edge, 'expected a wiki-link edge');
    assert.strictEqual(edge.weight >= 2, true);
  });

  test('resolves wiki links by a front-matter alias', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/source.md', '# Source #tag-a\n\nSee [[Atlas Program]].'),
      parseMarkdown('other/atlas.md', '---\naliases: [Atlas Program]\n---\n# Atlas #tag-b'),
    ]);

    assert.ok(findEdgeByTypes(snapshot, 'wiki-link'), 'expected a wiki-link edge');
  });

  test('links tasks and nested sections to their heading', () => {
    const snapshot = buildSnapshot([
      parseMarkdown(
        'notes/tasks.md',
        '# Parent #project/atlas\n\n- [ ] Do the thing #follow-up\n\n## Child #topic/detail',
      ),
    ]);

    const headingEdges = snapshot.edges.filter((edge) =>
      edge.types.includes('heading'),
    );
    const taskEdge = headingEdges.find(
      (edge) =>
        edge.source.startsWith('task:') || edge.target.startsWith('task:'),
    );
    const sectionEdge = headingEdges.find(
      (edge) =>
        edge.source.startsWith('section:') &&
        edge.target.startsWith('section:'),
    );
    assert.ok(taskEdge, 'expected a task heading edge');
    assert.ok(sectionEdge, 'expected a nested section heading edge');
  });

  test('uses ancestor heading tags as graph cluster anchors', () => {
    const snapshot = buildSnapshot([
      parseMarkdown(
        'notes/daily.md',
        '# Daily\n\n## Case #project/ashen-mirror\n\n### Dax #person/dax\n\nDax maintains the #feature/safe-perimeter.',
      ),
    ]);
    const inlineNode = snapshot.nodes.find(
      (node) =>
        node.kind === 'note' &&
        node.title.includes('Dax maintains'),
    );

    assert.ok(inlineNode);
    assert.deepStrictEqual(inlineNode.tagKeys, [
      '#feature/safe-perimeter',
      '#person/dax',
      '#project/ashen-mirror',
    ]);
  });

  test('creates tag nodes with membership edges and tag-only associations', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/a.md', '# Alpha #project/atlas #follow-up'),
      parseMarkdown('notes/b.md', '# Beta #project/atlas #follow-up'),
    ]);

    const tagNodes = snapshot.nodes.filter((node) => node.kind === 'tag');
    assert.strictEqual(tagNodes.length, 2);

    const membership = snapshot.edges.filter((edge) =>
      edge.types.includes('tag-membership'),
    );
    assert.strictEqual(membership.length, 4);

    snapshot.edges
      .filter((edge) => edge.types.includes('associated-tag'))
      .forEach((edge) => {
        assert.ok(edge.source.startsWith('tag:'));
        assert.ok(edge.target.startsWith('tag:'));
      });
  });

  test('projects connected notes, tasks, and tags from direct graph edges', () => {
    const snapshot = buildSnapshot([
      parseMarkdown(
        'notes/a.md',
        '# Alpha #project/atlas #risk/breach\n\n- [ ] Follow up #project/atlas',
      ),
      parseMarkdown('notes/b.md', '# Beta #project/atlas'),
    ]);
    const tagNode = snapshot.nodes.find(
      (node) => node.id === 'tag:#project/atlas',
    );
    assert.ok(tagNode);

    const connections = createNotesGraphConnections(snapshot, tagNode.id);

    assert.ok(connections.some((connection) => connection.node.kind === 'note'));
    assert.ok(connections.some((connection) => connection.node.kind === 'task'));
    assert.ok(connections.some((connection) => connection.node.kind === 'tag'));
    assert.ok(
      connections.every((connection) =>
        connection.types.some(
          (type) =>
            type === 'tag-membership' || type === 'associated-tag',
        ),
      ),
    );
  });

  test('includes metadata-only files as note nodes', () => {
    const snapshot = buildSnapshot([
      parseMarkdown(
        'notes/meta.md',
        '---\ntags: [project/atlas]\n---\nBody without headings.',
      ),
      parseMarkdown('notes/other.md', '# Other #project/atlas'),
    ]);

    const fileNode = snapshot.nodes.find((node) =>
      node.id.startsWith('file:'),
    );
    assert.ok(fileNode, 'expected a metadata-only file node');
    assert.strictEqual(fileNode.kind, 'note');
    assert.strictEqual(fileNode.line, 1);
  });

  test('counts tag-membership edges in note degrees', () => {
    const snapshot = buildSnapshot([
      parseMarkdown('notes/solo.md', '# Solo #only-tag'),
    ]);

    const noteNode = snapshot.nodes.find((node) => node.kind === 'note');
    const tagNode = snapshot.nodes.find((node) => node.kind === 'tag');
    assert.ok(noteNode && tagNode);
    assert.strictEqual(noteNode.degree, 1);
    assert.strictEqual(tagNode.degree, 1);
  });

  test('produces deterministic output', () => {
    const files = [
      parseMarkdown('notes/a.md', '# Alpha #project/atlas\n\n- [ ] Task #x'),
      parseMarkdown('notes/b.md', '# Beta #project/atlas\n\nSee [[a]].'),
    ];
    const first = buildSnapshot(files);
    const second = buildSnapshot(files);

    assert.strictEqual(
      JSON.stringify({ nodes: first.nodes, edges: first.edges }),
      JSON.stringify({ nodes: second.nodes, edges: second.edges }),
    );
  });
});

suite('Notes graph messages', () => {
  test('says a save changed the graph exactly when it changed something the graph draws', () => {
    const text = [
      '---',
      'tags: [area/home]',
      'aliases: [Hub]',
      '---',
      '# Atlas #project/atlas',
      'Words about [[relay]] and #topic/maps.',
      '## Detail #topic/detail',
      'More words.',
      '- [ ] Call [[relay]] #person/dana 📅 2026-10-01',
      '- [x] Done #project/atlas',
    ].join('\n');
    const base = parseMarkdown('notes/atlas.md', text, { createdAt: 1, updatedAt: 2 });
    const other = parseMarkdown('notes/relay.md', '# Relay #project/atlas #topic/maps');
    const indexOf = (file: ParsedFile) =>
      buildWorkspaceIndex(new Map([[file.filePath, file], [other.filePath, other]]));
    const before = indexOf(base);
    const graphOf = (index: ReturnType<typeof indexOf>) => ({
      ...createNotesGraphSnapshot(index),
      updatedAt: 0,
    });
    const detail = base.sections.findIndex((section) => section.heading.startsWith('Detail'));
    assert.ok(detail > 0 && base.sections[detail].headingTags?.length, 'a nested tagged heading');
    const variant = (change: (file: ParsedFile) => void): ParsedFile => {
      const copy = structuredClone(base);
      change(copy);
      return copy;
    };

    // Every field the graph reads. A field the graph starts reading joins
    // graphSignature and this list.
    const drawn: Record<string, (file: ParsedFile) => void> = {
      'section id': (file) => { file.sections[0].id += 'x'; },
      'heading': (file) => { file.sections[0].heading = 'Atlas two #project/atlas'; },
      'heading level': (file) => { file.sections[detail].headingLevel = 3; },
      'inline entry': (file) => { file.sections[detail].isInline = !file.sections[detail].isInline; },
      'section line': (file) => { file.sections[0].startLine += 1; },
      'section parent': (file) => { file.sections[detail].parentSectionId = undefined; },
      'section tags': (file) => { file.sections[0].tags = [...file.sections[0].tags, '#topic/new']; },
      'section tag spelling': (file) => { file.sections[0].tagLabels = { ...file.sections[0].tagLabels, '#project/atlas': '#Project/Atlas' }; },
      'body tags': (file) => { file.sections[0].bodyTags = [...(file.sections[0].bodyTags ?? []), { key: '#topic/x', label: '#topic/x', line: 6 }]; },
      'heading tags': (file) => { file.sections[detail].headingTags = [...(file.sections[detail].headingTags ?? []), { key: '#topic/x', label: '#topic/x' }]; },
      'section tag groups': (file) => { file.sections[0].associationTagGroups = [...(file.sections[0].associationTagGroups ?? []), [{ key: '#a', label: '#a' }, { key: '#b', label: '#b' }]]; },
      'section links': (file) => { file.sections[0].links = []; },
      'task id': (file) => { file.tasks[0].id += 'x'; },
      'task title': (file) => { file.tasks[0].title = 'Write to [[relay]]'; },
      'task line': (file) => { file.tasks[0].lineNumber += 1; },
      'task heading': (file) => { file.tasks[0].sectionId = undefined; },
      'task tags': (file) => { file.tasks[0].tags = []; },
      'task tag spelling': (file) => { file.tasks[0].tagLabels = { '#person/dana': '#Person/Dana' }; },
      'task tag groups': (file) => { file.tasks[0].associationTagGroups = [...(file.tasks[0].associationTagGroups ?? []), [{ key: '#a', label: '#a' }, { key: '#b', label: '#b' }]]; },
      'task links': (file) => { file.tasks[0].sourceLineText = '- [ ] Call #person/dana'; },
      'front-matter tags': (file) => { file.frontmatterTags = []; },
      'note links': (file) => { file.links = []; },
      'aliases': (file) => { file.aliases = []; },
      'entry count': (file) => { file.sections = []; },
    };
    for (const [field, change] of Object.entries(drawn)) {
      assert.strictEqual(graphInputsChanged(before, indexOf(variant(change))), true, field);
    }

    // What the graph does not read: changing it leaves the graph as it was.
    const notDrawn: Record<string, (file: ParsedFile) => void> = {
      'content': (file) => { file.content += '\nMore prose.'; },
      'raw content': (file) => { file.sections[0].rawContent += ' prose'; },
      'body content': (file) => { file.sections[0].bodyContent += ' prose'; },
      'note dates': (file) => { file.createdAt = 5; file.updatedAt = 6; },
      'file times': (file) => { file.fileTimes = { createdAt: 7, updatedAt: 8 }; },
      'section dates': (file) => { file.sections[0].updatedAt = 9; },
      'section end': (file) => { file.sections[0].endLine += 3; file.sections[0].bodyEndLine += 3; },
      'body tag line': (file) => { file.sections.forEach((section) => (section.bodyTags ?? []).forEach((tag) => { tag.line += 1; })); },
      'task status': (file) => { file.tasks[0].completed = true; file.tasks[0].checkboxValue = 'x'; file.tasks[0].sourceLineText = file.tasks[0].sourceLineText.replace('[ ]', '[x]'); },
      'task due and priority': (file) => { file.tasks[0].dueAt = 10; file.tasks[0].dueText = '2026-11-01'; file.tasks[0].priority = 'high'; },
      'block ids': (file) => { file.blockIds = { q3: 6 }; },
      'hub': (file) => { file.hub = { describes: [{ key: '#project/atlas', label: '#project/atlas' }], properties: [] }; },
    };
    for (const [field, change] of Object.entries(notDrawn)) {
      const after = indexOf(variant(change));
      assert.strictEqual(graphInputsChanged(before, after), false, field);
      assert.deepStrictEqual(graphOf(after), graphOf(before), `${field}: the graph is the same`);
    }

    // A prose edit, parsed for real, is not a change either.
    const prose = parseMarkdown('notes/atlas.md', text.replace('More words.', 'More words, and more.'));
    assert.strictEqual(graphInputsChanged(before, indexOf(prose)), false);
    assert.deepStrictEqual(graphOf(indexOf(prose)), graphOf(before));

    // Notes coming, going, or changing order are.
    const third = parseMarkdown('notes/third.md', '# Third');
    const withThird = buildWorkspaceIndex(new Map([[base.filePath, base], [other.filePath, other], [third.filePath, third]]));
    assert.strictEqual(graphInputsChanged(before, withThird), true, 'a note added');
    assert.strictEqual(graphInputsChanged(withThird, before), true, 'a note removed');
    const reordered = buildWorkspaceIndex(new Map([[other.filePath, other], [base.filePath, base]]));
    assert.strictEqual(graphInputsChanged(before, reordered), true, 'the same notes in another order');
    assert.strictEqual(graphInputsChanged(undefined, before), true, 'nothing drawn yet');
    assert.strictEqual(graphInputsChanged(before, before), false);
  });

  test('accepts valid openSource and openTag messages', () => {
    assert.deepStrictEqual(
      parseNotesGraphMessage({
        type: 'openSource',
        filePath: 'notes/a.md',
        line: 3,
      }),
      { type: 'openSource', filePath: 'notes/a.md', line: 3 },
    );
    assert.deepStrictEqual(
      parseNotesGraphMessage({ type: 'openTag', tagKey: 'project/atlas' }),
      { type: 'openTag', tagKey: 'project/atlas' },
    );
    assert.deepStrictEqual(
      parseNotesGraphMessage({
        type: 'selectNode',
        nodeId: 'section:notes/a.md:3',
      }),
      { type: 'selectNode', nodeId: 'section:notes/a.md:3' },
    );
    assert.deepStrictEqual(parseNotesGraphMessage({ type: 'clearSelection' }), {
      type: 'clearSelection',
    });
  });

  test('rejects malformed messages', () => {
    assert.strictEqual(parseNotesGraphMessage(undefined), undefined);
    assert.strictEqual(parseNotesGraphMessage({ type: 'unknown' }), undefined);
    assert.strictEqual(
      parseNotesGraphMessage({ type: 'openSource', filePath: 'a.md', line: 0 }),
      undefined,
    );
    assert.strictEqual(
      parseNotesGraphMessage({
        type: 'openSource',
        filePath: 'a.md',
        line: 1.5,
      }),
      undefined,
    );
    assert.strictEqual(
      parseNotesGraphMessage({ type: 'openTag', tagKey: '' }),
      undefined,
    );
    assert.strictEqual(
      parseNotesGraphMessage({ type: 'selectNode', nodeId: '' }),
      undefined,
    );
  });

  test('sidebar accepts the openNotesGraph shortcut', () => {
    assert.deepStrictEqual(parseSidebarMessage({ type: 'openNotesGraph' }), {
      type: 'openNotesGraph',
    });
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'activateNotesGraphNode',
        nodeId: 'task:related',
        open: false,
      }),
      {
        type: 'activateNotesGraphNode',
        nodeId: 'task:related',
        open: false,
      },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'hoverNotesGraphNode',
        nodeId: 'tag:#project/atlas',
      }),
      { type: 'hoverNotesGraphNode', nodeId: 'tag:#project/atlas' },
    );
    assert.deepStrictEqual(parseSidebarMessage({ type: 'hoverNotesGraphNode' }), {
      type: 'hoverNotesGraphNode',
    });
    assert.strictEqual(
      parseSidebarMessage({
        type: 'activateNotesGraphNode',
        nodeId: 'task:related',
        open: 'yes',
      }),
      undefined,
    );
  });
});

function buildSnapshot(files: ParsedFile[]): NotesGraphSnapshot {
  return createNotesGraphSnapshot(
    buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file]))),
  );
}

function findEdgeByTypes(
  snapshot: NotesGraphSnapshot,
  type: 'wiki-link' | 'heading' | 'associated-tag',
) {
  return snapshot.edges.find((edge) => edge.types.includes(type));
}
