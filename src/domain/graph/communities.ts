/**
 * How the Notes Graph groups what it draws, and which links it draws: the
 * page computes both from the graph the host sends, each time the reader
 * moves a slider, so they run on the page (decision D1 of
 * docs/implementation/20-webviews.md) and are tested here.
 *
 * Groups are visual communities, not a change to the indexed graph. Each
 * note or task starts in the group of its primary tag, the tag whose size
 * is nearest the size a group should have; then wiki links, headings, and
 * the evidence of specific tags merge those seeds over a few bounded passes
 * of label propagation. A tag on nearly every note, or on one, counts for
 * little, by its prevalence.
 *
 * Every function here is a typed port of the page script it replaced, with
 * the same arithmetic in the same order, and plain objects where the script
 * used them, so keys are visited in the order the script visited them.
 */
import type { NotesGraphEdgeType, NotesGraphNodeKind } from '../model/graph';

/** A node as the clustering reads it. */
export interface CommunityNode {
  readonly id: string;
  readonly kind: NotesGraphNodeKind;
}

/** An edge as the clustering reads it: its id is its two ends. */
export interface CommunityEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly weight: number;
  /** Every reason its ends are joined; none for an edge a focused graph joins through a daily note. */
  readonly types: readonly NotesGraphEdgeType[];
}

/** One tag a note or task carries, by the tag node's index, and how strongly. */
export interface TagMembership {
  readonly tagIndex: number;
  readonly weight: number;
}

/** What `buildCommunities` groups. */
export interface CommunityInput {
  /** The nodes drawn, tags among them. */
  readonly nodes: readonly CommunityNode[];
  /** Every edge between them, drawn or not. */
  readonly edges: readonly CommunityEdge[];
  /** Each node's tag memberships, by node index; none for a tag. */
  readonly memberships: readonly (readonly TagMembership[])[];
  /** How many notes and tasks carry each tag, by the tag node's index. */
  readonly membershipCount: Uint32Array;
  /** Each node's primary tag (`choosePrimaryTags`), or -1. */
  readonly primaryTags: Int32Array;
  /** Favor rare tags, from 0 to 1. */
  readonly tagSpecificity: number;
}

/** Two groups joined by direct links, and how strongly. */
export interface CommunityLink {
  readonly a: number;
  readonly b: number;
  readonly weight: number;
}

/** The groups `buildCommunities` found. */
export interface Communities {
  /** Each node's group, by node index; -1 for a tag no note or task carries. */
  readonly ids: Int32Array;
  /** How many notes and tasks each group holds; tags are not counted. */
  readonly sizes: number[];
  /** The groups joined by direct links between their members. */
  readonly edges: CommunityLink[];
}

/** Each node's primary tag, and how many notes and tasks each tag is primary for. */
export interface PrimaryTags {
  /** By node index: the tag node's index, or -1 for a tag or a node with none. */
  readonly primaryTag: Int32Array;
  /** By tag node index. */
  readonly primaryClusterSize: Uint32Array;
}

/** What `selectSalientEdges` keeps each node's strongest links by. */
export interface SalienceOptions {
  /** Links per note, from 0.15 to 1; anything else is clamped, and a non-number reads as 0.45. */
  readonly density: number;
  /** Favor rare tags, from 0 to 1. */
  readonly specificity: number;
  /** Links between groups, from 0 to 1. */
  readonly bridgeStrength: number;
}

/** What `graphEdgeSalience` scores an edge against. */
export interface SalienceContext {
  readonly nodeById: Readonly<Record<string, CommunityNode>>;
  /** How many notes and tasks carry each tag, by tag key. */
  readonly memberCountByTag: Readonly<Record<string, number>>;
  readonly targetClusterSize: number;
  /** Each note's or task's primary tag, by node id, as a tag node id. */
  readonly primaryTagByNode: Readonly<Record<string, string>>;
  readonly bridgeStrength: number;
  readonly specificity: number;
}

/** A tag's member as the clustering keeps it. */
interface TagMember {
  readonly nodeIndex: number;
  readonly weight: number;
}

/** A neighbor joined by a direct link, and how strongly. */
interface Neighbor {
  readonly index: number;
  readonly weight: number;
}

/** What every pass of `buildCommunities` reads. */
interface CommunityContext {
  readonly directNeighbors: Neighbor[][];
  /** Each tag's members, by the tag node's index. */
  readonly tagMembers: Record<string, TagMember[]>;
  readonly candidateIndexById: Record<string, number>;
  readonly targetClusterSize: number;
}

/**
 * The size a group should have: the square root of the notes and tasks
 * drawn, and never under 3. Tags do not count.
 */
export function targetClusterSize(nodes: readonly CommunityNode[]): number {
  const sourceCount = nodes.filter((node) => node.kind !== 'tag').length;
  return Math.max(3, Math.sqrt(sourceCount));
}

/**
 * Each note's and task's primary tag: of the tags it carries, the one whose
 * number of members is nearest `targetClusterSize`, with a little for the
 * membership's own weight; a tag carried once fits least. A tie keeps the
 * first. Also counts, for each tag, the nodes it is primary for.
 */
export function choosePrimaryTags(
  nodes: readonly CommunityNode[],
  memberships: readonly (readonly TagMembership[])[],
  membershipCount: Uint32Array,
): PrimaryTags {
  const count = nodes.length;
  const primaryTag = new Int32Array(count);
  const primaryClusterSize = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    primaryTag[index] = -1;
  }
  const target = targetClusterSize(nodes);
  for (let memberIndex = 0; memberIndex < count; memberIndex += 1) {
    if (nodes[memberIndex].kind === 'tag' || !memberships[memberIndex].length) {
      continue;
    }
    const best = bestMembership(memberships[memberIndex], membershipCount, target);
    primaryTag[memberIndex] = best.tagIndex;
    primaryClusterSize[best.tagIndex] += 1;
  }
  return { primaryTag, primaryClusterSize };
}

/** The membership whose tag's size best fits the target; the first of equals. */
function bestMembership(
  memberships: readonly TagMembership[],
  membershipCount: Uint32Array,
  target: number,
): TagMembership {
  let best = memberships[0];
  let bestScore = -Infinity;
  memberships.forEach((membership) => {
    const members = membershipCount[membership.tagIndex];
    const sizeScore = members > 1
      ? 1 / (1 + Math.abs(Math.log(members / target)))
      : 0.05;
    const score = sizeScore + membership.weight * 0.05;
    if (!(score > bestScore)) {
      return;
    }
    best = membership;
    bestScore = score;
  });
  return best;
}

/**
 * Groups the notes and tasks: primary tags seed the groups, then five
 * passes move each node to the group its links and its tags' evidence
 * favor most, the lowest-numbered on a tie. Each tag joins the group whose
 * members carry it with the most evidence. Groups are numbered by their
 * seed, ascending.
 */
export function buildCommunities(input: CommunityInput): Communities {
  const context = indexCommunityInput(input);
  let labels = seedLabels(input);
  for (let pass = 0; pass < 5; pass += 1) {
    labels = propagateLabels(input, context, labels);
  }
  const { ids, sizes } = numberCommunities(input.nodes, labels);
  assignTagCommunities(input, context, ids);
  return { ids, sizes, edges: linkCommunities(input, context.candidateIndexById, ids) };
}

/**
 * How strongly a direct link between two notes or tasks joins them: a
 * little for any link, more for a heading, most for a wiki link.
 */
function directLinkWeight(types: readonly NotesGraphEdgeType[]): number {
  let weight = 0.6;
  if (types.indexOf('wiki-link') !== -1) {
    weight += 3.5;
  }
  if (types.indexOf('heading') !== -1) {
    weight += 1.5;
  }
  return weight;
}

/** Each node's direct neighbors and each tag's members, by index. */
function indexCommunityInput(input: CommunityInput): CommunityContext {
  const { nodes, memberships } = input;
  const count = nodes.length;
  const directNeighbors: Neighbor[][] = [];
  const tagMembers: Record<string, TagMember[]> = {};
  const candidateIndexById: Record<string, number> = {};
  for (let index = 0; index < count; index += 1) {
    candidateIndexById[nodes[index].id] = index;
    directNeighbors.push([]);
    if (nodes[index].kind !== 'tag') {
      memberships[index].forEach((membership) => {
        (tagMembers[membership.tagIndex] ||
          (tagMembers[membership.tagIndex] = [])).push({
          nodeIndex: index,
          weight: membership.weight,
        });
      });
    }
  }
  input.edges.forEach((edge) => {
    const sourceIndex = candidateIndexById[edge.source];
    const targetIndex = candidateIndexById[edge.target];
    const source = sourceIndex === undefined ? null : nodes[sourceIndex];
    const target = targetIndex === undefined ? null : nodes[targetIndex];
    if (!source || !target || source.kind === 'tag' || target.kind === 'tag') {
      return;
    }
    const weight = directLinkWeight(edge.types);
    directNeighbors[sourceIndex].push({ index: targetIndex, weight });
    directNeighbors[targetIndex].push({ index: sourceIndex, weight });
  });
  return { directNeighbors, tagMembers, candidateIndexById, targetClusterSize: targetClusterSize(nodes) };
}

/** The label each node starts with: its primary tag, or one of its own past every node; none for a tag. */
function seedLabels(input: CommunityInput): Int32Array {
  const count = input.nodes.length;
  const labels = new Int32Array(count);
  for (let seed = 0; seed < count; seed += 1) {
    if (input.nodes[seed].kind === 'tag') {
      labels[seed] = -1;
    } else if (input.primaryTags[seed] >= 0) {
      labels[seed] = input.primaryTags[seed];
    } else {
      labels[seed] = count + seed;
    }
  }
  return labels;
}

/** A tag membership's evidence for the clustering, by its tag's prevalence. */
function membershipEvidence(input: CommunityInput, context: CommunityContext, tagIndex: number, weight: number): number {
  return tagMembershipScore(
    weight,
    input.membershipCount[tagIndex] || 1,
    context.targetClusterSize,
    input.tagSpecificity,
  );
}

/**
 * Each tag's label: the label its members carry with the most evidence,
 * the lowest on a tie; -1 for a tag none of whose members is labeled.
 */
function chooseTagLabels(input: CommunityInput, context: CommunityContext, currentLabels: Int32Array): Record<string, number> {
  const tagLabels: Record<string, number> = {};
  Object.keys(context.tagMembers).forEach((tagKey) => {
    const scores: Record<string, number> = {};
    context.tagMembers[tagKey].forEach((member) => {
      const label = currentLabels[member.nodeIndex];
      if (label < 0) {
        return;
      }
      const evidence = membershipEvidence(input, context, Number(tagKey), member.weight);
      const labelKey = String(label);
      scores[labelKey] = (scores[labelKey] || 0) + evidence;
    });
    let bestLabel = -1;
    let bestScore = -Infinity;
    Object.keys(scores).forEach((labelKey) => {
      const label = Number(labelKey);
      const score = scores[labelKey];
      if (!(score > bestScore || score === bestScore && (bestLabel < 0 || label < bestLabel))) {
        return;
      }
      bestLabel = label;
      bestScore = score;
    });
    tagLabels[tagKey] = bestLabel;
  });
  return tagLabels;
}

/** One pass: each note and task takes the label its neighbors and tags favor most. */
function propagateLabels(input: CommunityInput, context: CommunityContext, labels: Int32Array): Int32Array {
  const tagLabels = chooseTagLabels(input, context, labels);
  const nextLabels = new Int32Array(labels);
  for (let nodeIndex = 0; nodeIndex < input.nodes.length; nodeIndex += 1) {
    if (input.nodes[nodeIndex].kind === 'tag') {
      continue;
    }
    nextLabels[nodeIndex] = chooseNodeLabel(input, context, { labels, tagLabels, nodeIndex });
  }
  return nextLabels;
}

/** What one node's label is chosen from, in one pass. */
interface LabelChoice {
  readonly labels: Int32Array;
  readonly tagLabels: Readonly<Record<string, number>>;
  readonly nodeIndex: number;
}

/**
 * A node's next label: its own counts a little, each labeled neighbor its
 * link's weight, and each labeled tag its evidence, more for the primary
 * tag than for the others. The lowest label wins a tie.
 */
function chooseNodeLabel(input: CommunityInput, context: CommunityContext, choice: LabelChoice): number {
  const { labels, tagLabels, nodeIndex } = choice;
  const scores: Record<string, number> = {};
  const currentLabel = labels[nodeIndex];
  scores[String(currentLabel)] = 0.15;
  context.directNeighbors[nodeIndex].forEach((neighbor) => {
    const neighborLabel = labels[neighbor.index];
    if (neighborLabel < 0) {
      return;
    }
    const neighborKey = String(neighborLabel);
    scores[neighborKey] = (scores[neighborKey] || 0) + neighbor.weight;
  });
  input.memberships[nodeIndex].forEach((membership) => {
    const tagLabel = tagLabels[membership.tagIndex];
    if (tagLabel === undefined || tagLabel < 0) {
      return;
    }
    let evidence = membershipEvidence(input, context, membership.tagIndex, membership.weight);
    evidence *= input.primaryTags[nodeIndex] === membership.tagIndex
      ? 1.25
      : 0.45;
    const tagLabelKey = String(tagLabel);
    scores[tagLabelKey] = (scores[tagLabelKey] || 0) + evidence;
  });
  let bestLabel = currentLabel;
  let bestScore = scores[String(currentLabel)] || 0;
  Object.keys(scores).forEach((labelKey) => {
    const label = Number(labelKey);
    const score = scores[labelKey];
    if (!(score > bestScore || score === bestScore && label < bestLabel)) {
      return;
    }
    bestLabel = label;
    bestScore = score;
  });
  return bestLabel;
}

/** Numbers the labels the notes and tasks ended with, ascending, and counts each group. */
function numberCommunities(nodes: readonly CommunityNode[], labels: Int32Array): { ids: Int32Array; sizes: number[] } {
  const count = nodes.length;
  const labelKeys: Record<string, true> = {};
  for (let labeled = 0; labeled < count; labeled += 1) {
    if (nodes[labeled].kind !== 'tag') {
      labelKeys[String(labels[labeled])] = true;
    }
  }
  const sortedLabels = Object.keys(labelKeys).map((value) => Number(value)).sort((left, right) => left - right);
  const labelToCommunity: Record<string, number> = {};
  sortedLabels.forEach((label, community) => {
    labelToCommunity[String(label)] = community;
  });
  const ids = new Int32Array(count);
  for (let idIndex = 0; idIndex < count; idIndex += 1) {
    ids[idIndex] = -1;
  }
  const sizes: number[] = [];
  sortedLabels.forEach(() => sizes.push(0));
  for (let assigned = 0; assigned < count; assigned += 1) {
    if (nodes[assigned].kind === 'tag') {
      continue;
    }
    const assignedCommunity = labelToCommunity[String(labels[assigned])];
    ids[assigned] = assignedCommunity;
    sizes[assignedCommunity] += 1;
  }
  return { ids, sizes };
}

/** Puts each tag in the group whose members carry it with the most evidence, the lowest on a tie. */
function assignTagCommunities(input: CommunityInput, context: CommunityContext, ids: Int32Array): void {
  const count = input.nodes.length;
  Object.keys(context.tagMembers).forEach((tagKey) => {
    const communityScores: Record<string, number> = {};
    context.tagMembers[tagKey].forEach((member) => {
      const memberCommunity = ids[member.nodeIndex];
      if (memberCommunity < 0) {
        return;
      }
      const score = membershipEvidence(input, context, Number(tagKey), member.weight);
      communityScores[String(memberCommunity)] = (communityScores[String(memberCommunity)] || 0) + score;
    });
    let bestCommunity = -1;
    let bestCommunityScore = -Infinity;
    Object.keys(communityScores).forEach((communityKey) => {
      const community = Number(communityKey);
      const score = communityScores[communityKey];
      if (!(score > bestCommunityScore ||
          score === bestCommunityScore && (bestCommunity < 0 || community < bestCommunity))) {
        return;
      }
      bestCommunity = community;
      bestCommunityScore = score;
    });
    const tagIndex = Number(tagKey);
    if (tagIndex >= 0 && tagIndex < count) {
      ids[tagIndex] = bestCommunity;
    }
  });
}

/** The groups joined by direct links between their notes and tasks, each pair once, in the order first found. */
function linkCommunities(input: CommunityInput, candidateIndexById: Record<string, number>, ids: Int32Array): CommunityLink[] {
  const { nodes } = input;
  const communityEdgeWeights: Record<string, number> = {};
  input.edges.forEach((edge) => {
    const sourceIndex = candidateIndexById[edge.source];
    const targetIndex = candidateIndexById[edge.target];
    if (sourceIndex === undefined || targetIndex === undefined ||
        nodes[sourceIndex].kind === 'tag' ||
        nodes[targetIndex].kind === 'tag') {
      return;
    }
    const sourceCommunity = ids[sourceIndex];
    const targetCommunity = ids[targetIndex];
    if (sourceCommunity < 0 || targetCommunity < 0 || sourceCommunity === targetCommunity) {
      return;
    }
    const edgeWeight = directLinkWeight(edge.types);
    const low = Math.min(sourceCommunity, targetCommunity);
    const high = Math.max(sourceCommunity, targetCommunity);
    const key = low + ':' + high;
    communityEdgeWeights[key] = (communityEdgeWeights[key] || 0) + edgeWeight;
  });
  return Object.keys(communityEdgeWeights).map((key) => {
    const parts = key.split(':');
    return { a: Number(parts[0]), b: Number(parts[1]), weight: communityEdgeWeights[key] };
  });
}

/** A tag membership edge's note or task, and its tag, by node id. */
function membershipEnds(edge: CommunityEdge, nodeById: Readonly<Record<string, CommunityNode>>): { noteId: string; tagId: string } {
  const sourceIsTag = nodeById[edge.source].kind === 'tag';
  return {
    noteId: sourceIsTag ? edge.target : edge.source,
    tagId: sourceIsTag ? edge.source : edge.target,
  };
}

/**
 * The links worth drawing: each node keeps its strongest few, more with
 * Links per note, and an edge is drawn when either end kept it, or, for a
 * tag's edge, when both did. Anything scoring under a floor, which falls as
 * the density rises, is left out. The edges come back in the order given.
 */
export function selectSalientEdges<E extends CommunityEdge>(
  candidateNodes: readonly CommunityNode[],
  allEdges: readonly E[],
  options: SalienceOptions,
): E[] {
  const { density, specificity, bridgeStrength } = options;
  const nodeById: Record<string, CommunityNode> = {};
  candidateNodes.forEach((node) => {
    nodeById[node.id] = node;
  });
  const target = targetClusterSize(candidateNodes);
  const memberCountByTag = countTagMembers(allEdges, nodeById);
  const primaryTagByNode = choosePrimaryTagsById(allEdges, { nodeById, memberCountByTag, target, specificity });
  const context: SalienceContext = {
    nodeById,
    memberCountByTag,
    targetClusterSize: target,
    primaryTagByNode,
    bridgeStrength,
    specificity,
  };
  const scored = allEdges.map((edge) => ({ edge, score: graphEdgeSalience(edge, context) }));
  const clampedDensity = Math.max(0.15, Math.min(1, finiteNumber(density, 0.45)));
  const selectedByNode = keepStrongestPerNode(scored, nodeById, memberCountByTag, clampedDensity);
  const minimumScore = 0.06 + (1 - clampedDensity) * 0.1;
  return scored
    .filter((item) => {
      if (item.score < minimumScore) {
        return false;
      }
      const edge = item.edge;
      const selectedA = selectedByNode[edge.source] && selectedByNode[edge.source][edge.id];
      const selectedB = selectedByNode[edge.target] && selectedByNode[edge.target][edge.id];
      const hasTagRelationship =
        edge.types.indexOf('tag-membership') !== -1 ||
        edge.types.indexOf('associated-tag') !== -1;
      return hasTagRelationship
        ? selectedA && selectedB
        : selectedA || selectedB;
    })
    .map((item) => item.edge);
}

/** How many tag memberships each tag has, by tag key. */
function countTagMembers(
  allEdges: readonly CommunityEdge[],
  nodeById: Readonly<Record<string, CommunityNode>>,
): Record<string, number> {
  const memberCountByTag: Record<string, number> = {};
  allEdges.forEach((edge) => {
    if (edge.types.indexOf('tag-membership') === -1) {
      return;
    }
    const tagId = nodeById[edge.source].kind === 'tag'
      ? edge.source
      : edge.target;
    const tagKey = tagId.slice(4);
    memberCountByTag[tagKey] = (memberCountByTag[tagKey] || 0) + 1;
  });
  return memberCountByTag;
}

/** What each node's primary tag is chosen by, for `selectSalientEdges`. */
interface PrimaryChoice {
  readonly nodeById: Readonly<Record<string, CommunityNode>>;
  readonly memberCountByTag: Readonly<Record<string, number>>;
  readonly target: number;
  readonly specificity: number;
}

/**
 * Each note's and task's primary tag for drawing, by node id: its
 * best-scoring membership, the first tag id in order on a tie.
 */
function choosePrimaryTagsById(allEdges: readonly CommunityEdge[], choice: PrimaryChoice): Record<string, string> {
  const { nodeById, memberCountByTag, target, specificity } = choice;
  const primaryTagByNode: Record<string, string> = {};
  const membershipsByNode: Record<string, { edge: CommunityEdge; tagId: string }[]> = {};
  allEdges.forEach((edge) => {
    if (edge.types.indexOf('tag-membership') === -1) {
      return;
    }
    const { noteId, tagId } = membershipEnds(edge, nodeById);
    (membershipsByNode[noteId] || (membershipsByNode[noteId] = []))
      .push({ edge, tagId });
  });
  Object.keys(membershipsByNode).forEach((nodeId) => {
    membershipsByNode[nodeId].sort((left, right) => tagMembershipScore(
      right.edge.weight,
      memberCountByTag[right.tagId.slice(4)] || 1,
      target,
      specificity,
    ) - tagMembershipScore(
      left.edge.weight,
      memberCountByTag[left.tagId.slice(4)] || 1,
      target,
      specificity,
    ) || left.tagId.localeCompare(right.tagId));
    primaryTagByNode[nodeId] = membershipsByNode[nodeId][0].tagId;
  });
  return primaryTagByNode;
}

/**
 * The edges each node keeps, by node id and edge id: its best by score, the
 * first edge id in order on a tie, up to a budget that grows with the
 * density, and, for a tag, with how many carry it.
 */
function keepStrongestPerNode(
  scored: readonly { edge: CommunityEdge; score: number }[],
  nodeById: Readonly<Record<string, CommunityNode>>,
  memberCountByTag: Readonly<Record<string, number>>,
  clampedDensity: number,
): Record<string, Record<string, true>> {
  const incident: Record<string, { edge: CommunityEdge; score: number }[]> = {};
  scored.forEach((item) => {
    [item.edge.source, item.edge.target].forEach((nodeId) => {
      (incident[nodeId] || (incident[nodeId] = [])).push(item);
    });
  });
  const selectedByNode: Record<string, Record<string, true>> = {};
  Object.keys(incident).forEach((nodeId) => {
    const node = nodeById[nodeId];
    const tagCount = node.kind === 'tag'
      ? memberCountByTag[nodeId.slice(4)] || 1
      : 0;
    const budget = node.kind === 'tag'
      ? Math.max(8, Math.round(5 + Math.sqrt(tagCount) * (1 + clampedDensity * 2)))
      : Math.max(3, Math.round(3 + clampedDensity * 7));
    incident[nodeId].sort((left, right) => right.score - left.score ||
      left.edge.id.localeCompare(right.edge.id));
    selectedByNode[nodeId] = {};
    incident[nodeId].slice(0, budget).forEach((item) => {
      selectedByNode[nodeId][item.edge.id] = true;
    });
  });
  return selectedByNode;
}

/**
 * How much a tag membership says about where a note belongs: most for a
 * tag whose size is near the target, less as it grows rarer or more
 * widespread, the more so as `specificity` rises, and little for a tag
 * carried once. A non-number `specificity` reads as 0.75.
 */
export function tagMembershipScore(
  weight: number,
  memberCount: number,
  targetClusterSize: number,
  specificity: number,
): number {
  const fit = memberCount > 1
    ? 1 / (1 + Math.abs(Math.log(memberCount / targetClusterSize)))
    : 0.05;
  const support = memberCount > 1
    ? Math.min(1, Math.log1p(memberCount) / Math.log1p(targetClusterSize))
    : 0.05;
  const exponent = 0.5 + unitValue(specificity, 0.75) * 2.5;
  return weight * Math.pow(fit, exponent) * support * 3;
}

/**
 * How much an edge is worth drawing: a wiki link most, then a heading or a
 * path through a daily note; a tag membership by its score, in full for the
 * note's primary tag and scaled by Links between groups for the others; and
 * a tag association by its weight, scaled the same way.
 */
export function graphEdgeSalience(edge: CommunityEdge, context: SalienceContext): number {
  let score = 0;
  // An edge a focused graph joins through a daily note stands for a link
  // path, so it is kept as a heading is rather than scored as nothing.
  if (edge.types.length === 0) {
    score += 0.9;
  }
  if (edge.types.indexOf('wiki-link') !== -1) {
    score += 2.5;
  }
  if (edge.types.indexOf('heading') !== -1) {
    score += 0.9;
  }
  if (edge.types.indexOf('associated-tag') !== -1) {
    score += (0.25 + Math.min(0.75, edge.weight)) *
      unitValue(context.bridgeStrength, 0.25);
  }
  if (edge.types.indexOf('tag-membership') !== -1) {
    score += membershipSalience(edge, context);
  }
  return score;
}

/** A tag membership edge's worth: its score, scaled by Links between groups unless the tag is the note's primary. */
function membershipSalience(edge: CommunityEdge, context: SalienceContext): number {
  const { noteId, tagId } = membershipEnds(edge, context.nodeById);
  const memberCount = context.memberCountByTag[tagId.slice(4)] || 1;
  const membershipScore = tagMembershipScore(
    edge.weight,
    memberCount,
    context.targetClusterSize,
    context.specificity,
  );
  const isPrimary = context.primaryTagByNode[noteId] === tagId;
  const bridge = unitValue(context.bridgeStrength, 0.25);
  return isPrimary ? membershipScore : membershipScore * bridge;
}

/** A value as a number, or `fallback` when it is not a finite one. */
function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return isFinite(number) ? number : fallback;
}

/** A value as a number from 0 to 1, or `fallback` when it is not a finite number. */
function unitValue(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(1, finiteNumber(value, fallback)));
}
