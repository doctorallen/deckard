import * as assert from 'assert';

import { loadGraphModules } from './graphBundle';

/** A node as the page draws it. */
interface Node {
  id: string;
  kind: 'note' | 'task' | 'tag';
  title: string;
  tagKeys: string[];
  degree: number;
}

/** An edge as the page draws it, by its ends' indices. */
interface Edge {
  a: number;
  b: number;
  weight: number;
  types: string[];
  kind: number;
  drawn: boolean;
}

/** The page's graph state, as far as these tests read and write it. */
type State = Record<string, unknown> & {
  nodes: Node[];
  edges: Edge[];
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  degrees: Float32Array;
  primaryTag: Int32Array;
  primaryClusterSize: Uint32Array;
  communityId: Int32Array;
  communitySizes: number[];
  communityAnchorX: Float32Array;
  communityAnchorY: Float32Array;
  communityVx: Float32Array;
  communityVy: Float32Array;
  tagOffsetX: Float32Array;
  tagOffsetY: Float32Array;
  communityEdges: { a: number; b: number; weight: number }[];
  communityCount: number;
  alpha: number;
  dragIndex: number;
  selectedIndex: number;
  selectedNeighbors: Record<number, true>;
  hoverIndex: number;
  namedGroupCount: number;
  groups: ({ key: string; name: string; size: number } | null)[];
  groupCenters: unknown[];
  labelRects: { key?: string }[];
};

/** One call on the recording context, or a property it was given. */
interface Call {
  op: string;
  args: unknown[];
}

/** The modules under test. */
interface GraphModules {
  emptyGraphState(): State;
  tick(state: State, settings: Record<string, unknown>): void;
  tickCommunityAnchors(state: State, settings: Record<string, unknown>): void;
  drawGraph(frame: Record<string, unknown>): void;
}

const graph = loadGraphModules<GraphModules>(['model', 'simulation', 'canvas']);

/** The settings a new page starts with. */
const DEFAULTS = {
  showNotes: true, showTasks: true, showTags: false, showOrphans: true, showParked: false, onlyWrittenLinks: false,
  selectedTags: [], group: '', search: '', nodeSize: 1, linkThickness: 1, linkDensity: 0.3, tagSpecificity: 0.9,
  bridgeStrength: 0.15, showAllLinks: false, headings: 'zoom', labelThreshold: 1.4, centerStrength: 0.4,
  clusterCohesion: 1.5, communitySpacing: 1.2, repelStrength: 220, linkStrength: 1, linkDistance: 32,
};

/** A note or a tag, by name. */
function node(name: string, kind: Node['kind'] = 'note', tagKeys: string[] = []): Node {
  return { id: `${kind === 'tag' ? 'tag' : 'section'}:${name}`, kind, title: name, tagKeys, degree: 1 };
}

/** An edge of one kind between two node indices, drawn. */
function link(a: number, b: number, types: string[], kind = 0): Edge {
  return { a, b, weight: 1, types, kind, drawn: true };
}

/** A graph laid out at the points given, in no group, hot. */
function layout(nodes: Node[], edges: Edge[], points: [number, number][]): State {
  const state = graph.emptyGraphState();
  const count = nodes.length;
  Object.assign(state, {
    nodes,
    edges,
    px: Float32Array.from(points.map(([x]) => x)),
    py: Float32Array.from(points.map(([, y]) => y)),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    degrees: new Float32Array(count),
    primaryTag: new Int32Array(count).fill(-1),
    primaryClusterSize: new Uint32Array(count),
    communityId: new Int32Array(count).fill(-1),
    tagOffsetX: new Float32Array(count),
    tagOffsetY: new Float32Array(count),
    adjacency: nodes.map(() => []),
    alpha: 1,
  });
  edges.forEach((edge) => {
    state.degrees[edge.a] += 1;
    state.degrees[edge.b] += 1;
  });
  return state;
}

/** Gives a graph groups: each node's group, and each group's anchor. */
function inGroups(state: State, ids: number[], anchors: [number, number][]): State {
  Object.assign(state, {
    communityId: Int32Array.from(ids),
    communityCount: anchors.length,
    communitySizes: anchors.map((_, group) => ids.filter((id) => id === group).length),
    communityAnchorX: Float32Array.from(anchors.map(([x]) => x)),
    communityAnchorY: Float32Array.from(anchors.map(([, y]) => y)),
    communityVx: new Float32Array(anchors.length),
    communityVy: new Float32Array(anchors.length),
  });
  return state;
}

/** The distance between two nodes. */
function apart(state: State, a: number, b: number): number {
  return Math.hypot(state.px[b] - state.px[a], state.py[b] - state.py[a]);
}

/** A 2D context that draws nothing and records every call and every property set, in order. */
function recordingContext(calls: Call[]): unknown {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'measureText') {
        return (text: string) => {
          calls.push({ op: 'measureText', args: [text] });
          return { width: text.length * 7 };
        };
      }
      return (...args: unknown[]) => calls.push({ op: String(property), args });
    },
    set(_target, property, value) {
      calls.push({ op: `=${String(property)}`, args: [value] });
      return true;
    },
  });
}

/** Draws one frame of a graph on an 800 by 600 canvas, and returns what was painted. */
function draw(state: State, change: { camera?: { x: number; y: number; k: number }; settings?: Record<string, unknown> } = {}): Call[] {
  const calls: Call[] = [];
  graph.drawGraph({
    canvas: { clientWidth: 800, clientHeight: 600 },
    ctx: recordingContext(calls),
    state,
    settings: { ...DEFAULTS, ...change.settings },
    camera: change.camera ?? { x: 400, y: 300, k: 1 },
    dpr: 2,
    colors: {
      background: 'bg', note: 'note', task: 'task', tag: 'tag', edge: 'edge',
      edgeHighlight: 'highlight', label: 'label', halo: 'halo', group: 'group',
    },
    forcedColors: false,
    labelFontSize: '11px',
    groupFontSize: '12px',
    monoFont: () => 'Mono',
  });
  return calls;
}

/** The value a property was last given before call `at`. */
function setting(calls: Call[], name: string, at = calls.length): unknown {
  for (let index = at - 1; index >= 0; index -= 1) {
    if (calls[index].op === `=${name}`) {
      return calls[index].args[0];
    }
  }
  return undefined;
}

suite('Notes Graph simulation', () => {
  test('a graph with no nodes is at rest at once, and the heat falls 2.28% a tick until it stops under 0.005', () => {
    const empty = layout([], [], []);
    graph.tick(empty, DEFAULTS);
    assert.strictEqual(empty.alpha, 0, 'nothing to move, so the frame loop stops');

    const state = layout([node('a'), node('b')], [], [[0, 0], [50, 0]]);
    graph.tick(state, DEFAULTS);
    assert.strictEqual(state.alpha, 1 + (0 - 1) * 0.0228);
    let ticks = 1;
    while (state.alpha > 0) {
      graph.tick(state, DEFAULTS);
      ticks += 1;
    }
    let expected = 1;
    let count = 0;
    while (expected >= 0.005) {
      expected += (0 - expected) * 0.0228;
      count += 1;
    }
    assert.strictEqual(ticks, count);
  });

  test('two nodes push apart, harder with Repel strength', () => {
    const moved = (repelStrength: number): number => {
      const state = layout([node('a'), node('b')], [], [[0, 0], [10, 0]]);
      graph.tick(state, { ...DEFAULTS, repelStrength });
      assert.ok(state.px[0] < 0 && state.px[1] > 10, 'apart');
      return apart(state, 0, 1) - 10;
    };
    assert.ok(moved(2000) > moved(50) * 10);
  });

  test('a link pulls its ends toward Link distance', () => {
    const state = layout([node('a', 'note', ['#x']), node('b', 'note', ['#x'])], [link(0, 1, ['wiki-link'])], [[0, 0], [300, 0]]);
    for (let step = 0; step < 100; step += 1) {
      graph.tick(state, DEFAULTS);
    }
    assert.ok(apart(state, 0, 1) < 100, String(apart(state, 0, 1)));
  });

  test('the node being dragged holds still, and the other end of its link comes to it', () => {
    const state = layout([node('a'), node('b')], [link(0, 1, ['wiki-link'])], [[0, 0], [300, 0]]);
    state.dragIndex = 0;
    for (let step = 0; step < 20; step += 1) {
      graph.tick(state, DEFAULTS);
    }
    assert.deepStrictEqual([state.px[0], state.py[0]], [0, 0]);
    assert.ok(state.px[1] < 300);
  });

  test('a tag link pulls only while tags are shown', () => {
    const run = (showTags: boolean): number => {
      const state = layout([node('a', 'note', ['#x']), node('#x', 'tag')], [link(0, 1, ['tag-membership'], 2)], [[0, 0], [200, 0]]);
      graph.tick(state, { ...DEFAULTS, showTags });
      return state.px[0];
    };
    assert.strictEqual(run(false), 0, 'a lone note with a tag and no group stays put');
    assert.ok(run(true) > 0, 'pulled toward its tag');
  });

  test('with tags shown, a note is pulled hard and close by its primary tag, and faintly by another', () => {
    const pulled = (primary: boolean): number => {
      const state = layout([node('a', 'note', ['#x']), node('#x', 'tag')], [link(0, 1, ['tag-membership'], 2)], [[0, 0], [200, 0]]);
      state.primaryTag[0] = primary ? 1 : -1;
      graph.tick(state, { ...DEFAULTS, showTags: true });
      return state.px[0];
    };
    // 3 times the strength toward 0.8 of Link distance, against 0.08 toward 1.6 of it.
    assert.strictEqual(pulled(true), Math.fround(200 * ((200 - 32 * 0.8) / 200 * 1 * 3) * 0.5 * 0.6));
    assert.ok(pulled(true) > pulled(false) * 40 && pulled(false) > 0);
  });

  test('a tag sits at its group anchor and offset, and an untagged note drifts to the middle', () => {
    const state = inGroups(layout([node('#x', 'tag'), node('loose')], [], [[0, 0], [400, 0]]), [0, -1], [[100, 50]]);
    state.tagOffsetX[0] = 5;
    state.tagOffsetY[0] = -3;
    graph.tick(state, DEFAULTS);
    assert.strictEqual(state.px[0], Math.fround(state.communityAnchorX[0] + 5));
    assert.strictEqual(state.py[0], Math.fround(state.communityAnchorY[0] - 3));
    assert.deepStrictEqual([state.vx[0], state.vy[0]], [0, 0]);
    assert.ok(state.communityAnchorX[0] < 100, 'the anchor is drawn to the middle');
    assert.ok(state.px[1] < 400, 'so is a note with no tags');
  });

  test('a note is drawn to its group, harder with Cluster cohesion', () => {
    const pulled = (clusterCohesion: number): number => {
      const state = inGroups(layout([node('a', 'note', ['#x'])], [], [[0, 0]]), [0], [[300, 0]]);
      graph.tick(state, { ...DEFAULTS, clusterCohesion });
      return state.px[0];
    };
    assert.ok(pulled(3) > pulled(0.5) * 5 && pulled(0.5) > 0);
  });

  test('groups crowding each other push apart, and groups joined by links pull together', () => {
    const crowded = inGroups(layout([node('a'), node('b')], [], [[0, 0], [10, 0]]), [0, 1], [[0, 0], [10, 0]]);
    graph.tickCommunityAnchors(crowded, DEFAULTS);
    assert.ok(crowded.communityAnchorX[1] - crowded.communityAnchorX[0] > 10);

    const far = inGroups(layout([node('a'), node('b')], [], [[0, 0], [2000, 0]]), [0, 1], [[0, 0], [2000, 0]]);
    far.communityEdges = [{ a: 0, b: 1, weight: 6 }];
    graph.tickCommunityAnchors(far, DEFAULTS);
    assert.ok(far.communityAnchorX[1] - far.communityAnchorX[0] < 2000 - 50);
  });
});

suite('Notes Graph canvas', () => {
  test('with no nodes, the background alone', () => {
    const calls = draw(layout([], [], []));
    assert.deepStrictEqual(calls, [
      { op: 'setTransform', args: [2, 0, 0, 2, 0, 0] },
      { op: '=fillStyle', args: ['bg'] },
      { op: 'fillRect', args: [0, 0, 800, 600] },
    ]);
  });

  test('each kind of edge is one stroke in its own dash, in screen pixels at any zoom', () => {
    const state = layout(
      [node('a'), node('b'), node('c'), node('d'), node('e')],
      [link(0, 1, ['wiki-link'], 0), link(1, 2, ['heading'], 1), link(2, 3, ['tag-membership'], 2), link(3, 4, [], 3)],
      [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]],
    );
    const calls = draw(state, { camera: { x: 400, y: 300, k: 2 } });
    const strokes = calls.flatMap((call, at) => (call.op === 'stroke'
      ? [{ dash: calls.slice(0, at).reverse().find((before) => before.op === 'setLineDash')?.args[0], cap: setting(calls, 'lineCap', at) }]
      : []));
    assert.deepStrictEqual(strokes, [
      { dash: [], cap: 'butt' },
      { dash: [2.5, 1.5], cap: 'butt' },
      { dash: [0.5, 1.5], cap: 'round' },
      { dash: [4, 1.5, 0.5, 1.5], cap: 'butt' },
    ]);
    assert.strictEqual(setting(calls, 'lineWidth', calls.findIndex((call) => call.op === 'stroke')), 0.5, 'Link thickness over the zoom');
  });

  test('past 3,000 lines in a frame the dashes are left off', () => {
    const count = 3002;
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`));
    const edges = Array.from({ length: count - 1 }, (_, i) => link(i, i + 1, ['heading'], 1));
    const calls = draw(layout(nodes, edges, nodes.map((_, i) => [i % 50, Math.floor(i / 50)])));
    const dashes = calls.filter((call) => call.op === 'setLineDash').map((call) => call.args[0]);
    assert.deepStrictEqual(dashes, [[], []]);
  });

  test('a selected node is ringed, its links are one highlight, and everything else is faint', () => {
    const state = layout([node('a'), node('b'), node('c')], [link(0, 1, ['wiki-link']), link(1, 2, ['wiki-link'])], [[0, 0], [20, 0], [40, 0]]);
    state.selectedIndex = 0;
    state.selectedNeighbors = { 1: true };
    const calls = draw(state);
    const strokes = calls.filter((call) => call.op === 'stroke').length;
    assert.strictEqual(strokes, 3, 'the other links, the highlight, the ring');
    const highlight = calls.findIndex((call) => call.op === '=strokeStyle' && call.args[0] === 'highlight');
    assert.ok(highlight > 0);
    assert.strictEqual(setting(calls, 'globalAlpha', highlight), Math.min(0.7, Math.min(0.45, 0.1 + 0.18) * 1.6) * 0.25, 'the rest dim');
    const ring = calls.filter((call) => call.op === 'arc').at(-1) as Call;
    assert.deepStrictEqual(ring.args, [0, 0, 2 + Math.sqrt(1) + 4, 0, 6.2832]);
    // Bright, then faint: c is neither the selection nor beside it.
    const fills = calls.filter((call) => call.op === 'fill').length;
    assert.strictEqual(fills, 6, 'one fill per kind, bright and faint');
    const arcAt = calls.findIndex((call) => call.op === 'arc' && call.args[0] === 40);
    assert.strictEqual(setting(calls, 'globalAlpha', arcAt), 0.15);
  });

  test('a tag is drawn only with Show tags, or beside the selection', () => {
    const state = layout([node('a'), node('#x', 'tag')], [link(0, 1, ['tag-membership'], 2)], [[0, 0], [20, 0]]);
    const arcs = (calls: Call[]) => calls.filter((call) => call.op === 'arc').length;
    assert.strictEqual(arcs(draw(state)), 1);
    assert.strictEqual(arcs(draw(state, { settings: { showTags: true } })), 2);
    state.selectedIndex = 0;
    state.selectedNeighbors = { 1: true };
    assert.strictEqual(arcs(draw(state)), 3, 'both, and the ring');
  });

  test('at rest the largest groups are named over their discs, and the names are kept for a click', () => {
    const state = inGroups(
      layout([node('a'), node('b'), node('c'), node('d'), node('e')], [], [[-100, 0], [-90, 0], [100, 0], [110, 0], [120, 0]]),
      [0, 0, 1, 1, 1],
      [[-95, 0], [110, 0]],
    );
    state.groups = [{ key: '#small', name: 'small', size: 2 }, { key: '#large', name: 'large', size: 3 }];
    state.namedGroupCount = 2;
    const calls = draw(state, { camera: { x: 400, y: 300, k: 0.9 } });
    assert.deepStrictEqual(calls.filter((call) => call.op === 'strokeText').map((call) => call.args[0]), ['large', 'small']);
    assert.deepStrictEqual(state.labelRects.map((rect) => rect.key), ['#large', '#small']);
    assert.strictEqual(state.groupCenters.length, 2);
    assert.strictEqual(setting(calls, 'font', calls.findIndex((call) => call.op === 'strokeText')), '700 12px Mono');
  });

  test('zoomed in past Label fade zoom, each node big enough is named, cut to 28 characters', () => {
    const long = 'A title far too long to be drawn in full under its node';
    const state = layout([node(long), node('short')], [], [[0, 0], [60, 0]]);
    state.nodes[0].degree = 100;
    const calls = draw(state, { camera: { x: 400, y: 300, k: 2 } });
    assert.deepStrictEqual(calls.filter((call) => call.op === 'fillText').map((call) => call.args[0]), [`${long.slice(0, 27)}…`]);
  });

  test('a node out of view is not drawn', () => {
    const state = layout([node('near'), node('far')], [], [[0, 0], [5000, 0]]);
    assert.strictEqual(draw(state).filter((call) => call.op === 'arc').length, 1);
  });
});
