import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  createNotesGraphConnections,
  createNotesGraphSnapshot,
} from '../ui/state/notesGraphState';
import {
  parseNotesGraphMessage,
  parseSidebarMessage,
} from '../ui/webview/messages';
import { NotesGraphSnapshot, ParsedFile } from '../core/types';

suite('Notes graph state', () => {
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
