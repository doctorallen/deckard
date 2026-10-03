import * as assert from 'assert';

import {
  buildCommunities,
  choosePrimaryTags,
  type CommunityEdge,
  type CommunityNode,
  graphEdgeSalience,
  type SalienceContext,
  selectSalientEdges,
  type TagMembership,
  tagMembershipScore,
  targetClusterSize,
} from '../domain/graph/communities';
import type { NotesGraphEdgeType } from '../domain/model/graph';

/** A note node by its short name. */
function note(name: string): CommunityNode {
  return { id: `section:${name}`, kind: 'note' };
}

/** A tag node by its key. */
function tag(key: string): CommunityNode {
  return { id: `tag:${key}`, kind: 'tag' };
}

/** An edge between two node ids, with its id made of its ends as the page makes it. */
function edge(source: string, target: string, types: NotesGraphEdgeType[], weight = 1): CommunityEdge {
  return { id: `${source}::${target}`, source, target, weight, types };
}

/** The memberships and member counts of a graph's tag-membership edges, as the page collects them. */
function membershipsOf(nodes: readonly CommunityNode[], edges: readonly CommunityEdge[]): {
  memberships: TagMembership[][];
  membershipCount: Uint32Array;
} {
  const index = new Map(nodes.map((node, at) => [node.id, at]));
  const memberships: TagMembership[][] = nodes.map(() => []);
  const membershipCount = new Uint32Array(nodes.length);
  for (const link of edges) {
    if (!link.types.includes('tag-membership')) {
      continue;
    }
    const a = index.get(link.source) as number;
    const b = index.get(link.target) as number;
    const [member, tagIndex] = nodes[a].kind === 'tag' ? [b, a] : [a, b];
    memberships[member].push({ tagIndex, weight: link.weight });
    membershipCount[tagIndex] += 1;
  }
  return { memberships, membershipCount };
}

/** Two rings of four notes, #a's and #b's, joined by one wiki link and one heading, a note on its own, and a tag no note carries. */
function twoRings(): { nodes: CommunityNode[]; edges: CommunityEdge[] } {
  const nodes = [tag('#a'), tag('#b'), ...['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3', 'lonely'].map(note), tag('#unused')];
  const edges: CommunityEdge[] = [];
  for (const group of ['a', 'b']) {
    for (let i = 0; i < 4; i += 1) {
      edges.push(edge(`section:${group}${i}`, `section:${group}${(i + 1) % 4}`, ['wiki-link']));
      edges.push(edge(`section:${group}${i}`, `tag:#${group}`, ['tag-membership']));
    }
  }
  edges.push(edge('section:a0', 'section:b0', ['wiki-link']));
  edges.push(edge('section:a1', 'section:b1', ['heading']));
  return { nodes, edges };
}

suite('Notes Graph communities', () => {
  test('a group aims at the square root of the notes and tasks drawn, never under 3, tags aside', () => {
    assert.strictEqual(targetClusterSize([note('a'), note('b'), tag('#x'), tag('#y'), tag('#z')]), 3);
    assert.strictEqual(targetClusterSize(Array.from({ length: 16 }, (_, i) => note(`n${i}`))), 4);
    assert.strictEqual(targetClusterSize([...Array.from({ length: 100 }, (_, i) => note(`n${i}`)), tag('#x')]), 10);
  });

  suite('membership weights', () => {
    test('a tag the size of a group counts in full, three times its weight', () => {
      assert.strictEqual(tagMembershipScore(1, 4, 4, 0.9), 3);
      assert.strictEqual(tagMembershipScore(0.5, 4, 4, 0.9), 1.5);
    });

    test('a tag carried once counts least', () => {
      const once = tagMembershipScore(1, 1, 4, 0.9);
      assert.strictEqual(once, Math.pow(0.05, 0.5 + 0.9 * 2.5) * 0.05 * 3);
      assert.ok(once < tagMembershipScore(1, 2, 4, 0.9));
    });

    test('a tag on nearly every note counts less than one near the size of a group, the more so as Favor rare tags rises', () => {
      const widespread = tagMembershipScore(1, 100, 10, 0.9);
      const fitting = tagMembershipScore(1, 10, 10, 0.9);
      assert.ok(widespread < fitting / 4, `${widespread} against ${fitting}`);
      assert.ok(tagMembershipScore(1, 100, 10, 1) < tagMembershipScore(1, 100, 10, 0));
      assert.strictEqual(tagMembershipScore(1, 10, 10, 1), tagMembershipScore(1, 10, 10, 0), 'a fitting tag is not discounted');
    });

    test('Favor rare tags reads as 0.75 when it is not a number, and stops at 0 and 1', () => {
      assert.strictEqual(tagMembershipScore(1, 50, 5, Number.NaN), tagMembershipScore(1, 50, 5, 0.75));
      assert.strictEqual(tagMembershipScore(1, 50, 5, 'high' as unknown as number), tagMembershipScore(1, 50, 5, 0.75));
      assert.strictEqual(tagMembershipScore(1, 50, 5, 7), tagMembershipScore(1, 50, 5, 1));
      assert.strictEqual(tagMembershipScore(1, 50, 5, -2), tagMembershipScore(1, 50, 5, 0));
    });
  });

  suite('cluster sizing', () => {
    test('a note is grouped by the tag nearest the size of a group, and each tag counts the notes it is primary for', () => {
      // Nine notes aim at groups of 3: #fit has 3 members, #small 2, #wide all 9.
      const notes = Array.from({ length: 9 }, (_, i) => note(`n${i}`));
      const nodes = [tag('#small'), tag('#fit'), tag('#wide'), ...notes];
      const edges = [
        ...notes.map((member) => edge(member.id, 'tag:#wide', ['tag-membership'])),
        ...notes.slice(0, 3).map((member) => edge(member.id, 'tag:#fit', ['tag-membership'])),
        ...notes.slice(0, 2).map((member) => edge(member.id, 'tag:#small', ['tag-membership'])),
      ];
      const { memberships, membershipCount } = membershipsOf(nodes, edges);
      const { primaryTag, primaryClusterSize } = choosePrimaryTags(nodes, memberships, membershipCount);
      assert.deepStrictEqual([...primaryTag], [-1, -1, -1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
      assert.deepStrictEqual([...primaryClusterSize.slice(0, 3)], [0, 3, 6]);
    });

    test('a heavier membership wins between tags of a size, and the first wins a tie', () => {
      const nodes = [tag('#x'), tag('#y'), note('a'), note('b'), note('c')];
      const edges = [
        edge('section:a', 'tag:#x', ['tag-membership'], 1),
        edge('section:a', 'tag:#y', ['tag-membership'], 3),
        edge('section:b', 'tag:#x', ['tag-membership']),
        edge('section:b', 'tag:#y', ['tag-membership']),
        edge('section:c', 'tag:#y', ['tag-membership']),
        edge('section:c', 'tag:#x', ['tag-membership']),
      ];
      const { memberships, membershipCount } = membershipsOf(nodes, edges);
      assert.deepStrictEqual([...choosePrimaryTags(nodes, memberships, membershipCount).primaryTag], [-1, -1, 1, 0, 1]);
    });
  });

  suite('groups', () => {
    const grouped = (tagSpecificity = 0.9) => {
      const { nodes, edges } = twoRings();
      const { memberships, membershipCount } = membershipsOf(nodes, edges);
      const { primaryTag } = choosePrimaryTags(nodes, memberships, membershipCount);
      return buildCommunities({ nodes, edges, memberships, membershipCount, primaryTags: primaryTag, tagSpecificity });
    };

    test('each ring is a group, numbered by its tag, and a note joined to nothing is a group of its own', () => {
      const { ids, sizes } = grouped();
      // #a, #b, a0–a3, b0–b3, lonely, #unused
      assert.deepStrictEqual([...ids], [0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 2, -1]);
      assert.deepStrictEqual(sizes, [4, 4, 1], 'tags are not counted');
    });

    test('groups are joined by the direct links between their notes, a wiki link weighing most', () => {
      const { edges } = grouped();
      assert.strictEqual(edges.length, 1);
      assert.strictEqual(edges[0].a, 0);
      assert.strictEqual(edges[0].b, 1);
      assert.ok(Math.abs(edges[0].weight - ((0.6 + 3.5) + (0.6 + 1.5))) < 1e-12, String(edges[0].weight));
    });

    test('links pull a note into the group it is linked with, over the tag it carries', () => {
      const { nodes, edges } = twoRings();
      // a2 carries #b instead of #a, but its links are all in the a ring.
      const own = edges.findIndex((link) => link.id === 'section:a2::tag:#a');
      edges.splice(own, 1, edge('section:a2', 'tag:#b', ['tag-membership']));
      const { memberships, membershipCount } = membershipsOf(nodes, edges);
      const { primaryTag } = choosePrimaryTags(nodes, memberships, membershipCount);
      const { ids } = buildCommunities({ nodes, edges, memberships, membershipCount, primaryTags: primaryTag, tagSpecificity: 0.9 });
      assert.strictEqual(primaryTag[4], 1, 'seeded with #b');
      assert.strictEqual(ids[4], ids[2], 'a2 goes with a0');
    });

    test('the same graph groups the same way every time', () => {
      assert.deepStrictEqual(grouped(), grouped());
      assert.deepStrictEqual(grouped(0), grouped(0));
    });
  });

  suite('links drawn', () => {
    const options = { density: 0.15, specificity: 0.9, bridgeStrength: 0.15 };

    test('each note keeps its strongest few, and a link either end keeps is drawn', () => {
      const nodes = Array.from({ length: 6 }, (_, i) => note(`n${i}`));
      const edges: CommunityEdge[] = [];
      for (let i = 0; i < 6; i += 1) {
        for (let j = i + 1; j < 6; j += 1) {
          edges.push(edge(`section:n${i}`, `section:n${j}`, ['heading']));
        }
      }
      const fewest = selectSalientEdges(nodes, edges, options);
      // Each keeps 4 of its 5; only n4–n5 is the last of both its ends.
      assert.deepStrictEqual(edges.filter((link) => !fewest.includes(link)).map((link) => link.id), ['section:n4::section:n5']);
      assert.strictEqual(selectSalientEdges(nodes, edges, { ...options, density: 1 }).length, 15);
    });

    test('a tag link is drawn only when the tag keeps it too', () => {
      const notes = Array.from({ length: 20 }, (_, i) => note(`m${String(i).padStart(2, '0')}`));
      const nodes = [tag('#busy'), ...notes];
      const edges = notes.map((member) => edge(member.id, 'tag:#busy', ['tag-membership']));
      // The tag keeps round(5 + √20 × 1.3) = 11 of its 20, the first by id on a tie.
      assert.deepStrictEqual(selectSalientEdges(nodes, edges, options), edges.slice(0, 11));
    });

    test('a link scoring under the floor is not drawn, and the floor falls as Links per note rises', () => {
      const nodes = [tag('#x'), tag('#y')];
      const association = [edge('tag:#x', 'tag:#y', ['associated-tag'], 0.5)];
      assert.deepStrictEqual(selectSalientEdges(nodes, association, { ...options, bridgeStrength: 0 }), []);
      assert.deepStrictEqual(selectSalientEdges(nodes, association, { ...options, bridgeStrength: 1 }), association);
      // 0.75 × 0.18 = 0.135 is under the floor of 0.145 at the least density, and over its 0.06 at the most.
      assert.deepStrictEqual(selectSalientEdges(nodes, association, { ...options, bridgeStrength: 0.18 }), []);
      assert.deepStrictEqual(selectSalientEdges(nodes, association, { ...options, density: 1, bridgeStrength: 0.18 }), association);
    });

    test('Links per note reads as 0.45 when it is not a number, and stops at 0.15 and 1', () => {
      const nodes = Array.from({ length: 8 }, (_, i) => note(`n${i}`));
      const edges: CommunityEdge[] = [];
      for (let i = 0; i < 8; i += 1) {
        for (let j = i + 1; j < 8; j += 1) {
          edges.push(edge(`section:n${i}`, `section:n${j}`, ['heading']));
        }
      }
      const at = (density: number) => selectSalientEdges(nodes, edges, { ...options, density }).length;
      assert.strictEqual(at(Number.NaN), at(0.45));
      assert.strictEqual(at(0), at(0.15));
      assert.strictEqual(at(3), at(1));
      assert.ok(at(0.15) < at(1));
    });
  });

  suite('edge salience', () => {
    const nodes = [note('a'), note('b'), tag('#x'), tag('#y')];
    const context = (change: Partial<SalienceContext> = {}): SalienceContext => ({
      nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
      memberCountByTag: { '#x': 4, '#y': 4 },
      targetClusterSize: 4,
      primaryTagByNode: { 'section:a': 'tag:#x' },
      bridgeStrength: 0.4,
      specificity: 0.9,
      ...change,
    });

    test('a wiki link scores most, a heading and a path through a daily note alike', () => {
      assert.strictEqual(graphEdgeSalience(edge('section:a', 'section:b', ['wiki-link']), context()), 2.5);
      assert.strictEqual(graphEdgeSalience(edge('section:a', 'section:b', ['heading']), context()), 0.9);
      assert.strictEqual(graphEdgeSalience(edge('section:a', 'section:b', []), context()), 0.9);
      assert.strictEqual(graphEdgeSalience(edge('section:a', 'section:b', ['wiki-link', 'heading']), context()), 2.5 + 0.9);
    });

    test('a tag association scores by its weight, up to 0.75, scaled by Links between groups', () => {
      assert.strictEqual(graphEdgeSalience(edge('tag:#x', 'tag:#y', ['associated-tag'], 0.5), context()), (0.25 + 0.5) * 0.4);
      assert.strictEqual(graphEdgeSalience(edge('tag:#x', 'tag:#y', ['associated-tag'], 2), context()), (0.25 + 0.75) * 0.4);
      assert.strictEqual(
        graphEdgeSalience(edge('tag:#x', 'tag:#y', ['associated-tag'], 0.5), context({ bridgeStrength: Number.NaN })),
        (0.25 + 0.5) * 0.25,
        'Links between groups reads as 0.25 when it is not a number',
      );
    });

    test('a membership counts in full for the primary tag, and scaled by Links between groups for another', () => {
      const full = tagMembershipScore(1, 4, 4, 0.9);
      assert.strictEqual(graphEdgeSalience(edge('section:a', 'tag:#x', ['tag-membership']), context()), full);
      assert.strictEqual(graphEdgeSalience(edge('tag:#y', 'section:a', ['tag-membership']), context()), full * 0.4, 'either way round');
      assert.strictEqual(graphEdgeSalience(edge('section:b', 'tag:#x', ['tag-membership']), context()), full * 0.4, 'b has no primary tag');
    });
  });
});
