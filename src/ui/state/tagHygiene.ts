import {
  TagInfo,
  TagMergeCandidate,
  TagMergeReason,
  WorkspaceIndex,
} from '../../core/types';

/**
 * Tags that look like two spellings of one idea.
 *
 * Merging exists, and Home already says which tags are new and which have no
 * hub, but nothing says that `#projct/atlas` and `#project/atlas` are the
 * same tag typed twice. These are the pairs worth looking at, each with the
 * reason it was picked, so the reader decides and Merge does the rest.
 */

/** How many comparisons the spelling pass is allowed before it stops. */
const COMPARISON_BUDGET = 250_000;

interface TagFacts {
  key: string;
  label: string;
  count: number;
  /** `@` tags are people, so they are compared against `#person/…` tags. */
  namespace: string;
  name: string;
}

/**
 * Pairs of tags that look alike, most confusable first, each pointing from
 * the tag with fewer entries to the one with more: merging spends the rarer
 * spelling and keeps the one the workspace already uses.
 */
export function findTagMergeCandidates(
  index: WorkspaceIndex,
  limit = 12,
): { candidates: TagMergeCandidate[]; total: number } {
  const tags = [...index.tags.values()]
    .filter((tag) => tag.count > 0)
    .map(toFacts)
    .sort((left, right) => left.key.localeCompare(right.key));
  const found = new Map<string, TagMergeCandidate>();
  const keep = (left: TagFacts, right: TagFacts, reason: TagMergeReason) => {
    const [source, target] = order(left, right);
    const pairKey = `${source.key}|${target.key}`;
    const existing = found.get(pairKey);
    if (existing && rank(existing.reason) <= rank(reason)) {
      return;
    }
    found.set(pairKey, {
      sourceKey: source.key,
      sourceLabel: source.label,
      sourceCount: source.count,
      targetKey: target.key,
      targetLabel: target.label,
      targetCount: target.count,
      reason,
      detail: describe(reason, source, target),
    });
  };

  // The exact passes first: everything they find is found by a shared key
  // rather than by comparing every tag with every other.
  groupBy(tags, (tag) => tag.name).forEach((group) =>
    eachPair(group, (left, right) =>
      keep(
        left,
        right,
        left.namespace === right.namespace ? 'marker' : 'namespace',
      ),
    ),
  );
  groupBy(tags, (tag) => `${tag.namespace}\u0000${collapse(tag.name)}`).forEach(
    (group) => eachPair(group, (left, right) => keep(left, right, 'separator')),
  );
  groupBy(
    tags,
    (tag) => `${tag.namespace}\u0000${singular(tag.name)}`,
  ).forEach((group) =>
    eachPair(group, (left, right) => keep(left, right, 'plural')),
  );

  // One typed character apart, within one namespace, which is where a typo
  // lands. Long names are allowed two.
  let comparisons = 0;
  groupBy(tags, (tag) => tag.namespace).forEach((group) => {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        if (comparisons >= COMPARISON_BUDGET) {
          return;
        }
        comparisons += 1;
        // A longer name can absorb two typos without becoming another word.
        const distance =
          Math.max(group[left].name.length, group[right].name.length) >= 8
            ? 2
            : 1;
        if (isWithinDistance(group[left].name, group[right].name, distance)) {
          keep(group[left], group[right], 'spelling');
        }
      }
    }
  });

  const candidates = [...found.values()].sort(
    (left, right) =>
      rank(left.reason) - rank(right.reason) ||
      left.sourceCount - right.sourceCount ||
      right.targetCount - left.targetCount ||
      left.sourceLabel.localeCompare(right.sourceLabel),
  );
  return { candidates: candidates.slice(0, limit), total: candidates.length };
}

function rank(reason: TagMergeReason): number {
  return ['marker', 'namespace', 'separator', 'plural', 'spelling'].indexOf(
    reason,
  );
}

function describe(
  reason: TagMergeReason,
  source: TagFacts,
  target: TagFacts,
): string {
  const counts = `${entries(source.count)} and ${entries(target.count)}`;
  switch (reason) {
    case 'marker':
      return `the same name written two ways, with ${counts}`;
    case 'namespace':
      return `the same name in two namespaces, with ${counts}`;
    case 'separator':
      return `the same name punctuated two ways, with ${counts}`;
    case 'plural':
      return `one is the plural of the other, with ${counts}`;
    default:
      return `one or two letters apart, with ${counts}`;
  }
}

function entries(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

/** The rarer tag first: it is the one a merge spends. */
function order(left: TagFacts, right: TagFacts): [TagFacts, TagFacts] {
  if (left.count !== right.count) {
    return left.count < right.count ? [left, right] : [right, left];
  }
  return left.label.localeCompare(right.label) <= 0
    ? [left, right]
    : [right, left];
}

function toFacts(tag: TagInfo): TagFacts {
  const key = tag.key.toLocaleLowerCase();
  if (!key.startsWith('#')) {
    // A person's marker is their namespace, so `@ren` meets `#person/ren`.
    return {
      key: tag.key,
      label: tag.label,
      count: tag.count,
      namespace: 'person',
      name: key.slice(1),
    };
  }
  const separator = key.indexOf('/');
  return {
    key: tag.key,
    label: tag.label,
    count: tag.count,
    namespace: separator < 0 ? '' : key.slice(1, separator),
    name: separator < 0 ? key.slice(1) : key.slice(separator + 1),
  };
}

function groupBy(
  tags: readonly TagFacts[],
  keyOf: (tag: TagFacts) => string,
): TagFacts[][] {
  const groups = new Map<string, TagFacts[]>();
  tags.forEach((tag) => {
    const key = keyOf(tag);
    groups.set(key, [...(groups.get(key) ?? []), tag]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

function eachPair(
  group: readonly TagFacts[],
  visit: (left: TagFacts, right: TagFacts) => void,
): void {
  for (let left = 0; left < group.length; left += 1) {
    for (let right = left + 1; right < group.length; right += 1) {
      visit(group[left], group[right]);
    }
  }
}

function collapse(name: string): string {
  return name.replace(/[-_ ]/g, '');
}

function singular(name: string): string {
  return name.replace(/(?:es|s)$/, '');
}

/**
 * Whether two names are at most `allowed` edits apart, counting two letters
 * written the wrong way round as one edit: `atals` for `atlas` is the typo
 * tags actually collect, and plain Levenshtein calls it two.
 *
 * The walk gives up as soon as a row is certain to exceed the allowance, so a
 * long pair costs no more than a short one.
 */
export function isWithinDistance(
  left: string,
  right: string,
  allowed: number,
): boolean {
  if (left === right) {
    return false;
  }
  if (Math.abs(left.length - right.length) > allowed) {
    return false;
  }
  let beforePrevious: number[] = [];
  let previous = Array.from(
    { length: right.length + 1 },
    (_value, index) => index,
  );
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, beforePrevious[column - 2] + 1);
      }
      current[column] = value;
      best = Math.min(best, value);
    }
    if (best > allowed) {
      return false;
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[right.length] <= allowed;
}
