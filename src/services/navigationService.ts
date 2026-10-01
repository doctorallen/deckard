import { resolveIndexedTagKey } from '../domain/index/tagNavigation';
import type { WorkspaceIndex } from '../domain/model';

/**
 * Which lines of a note a page may open. A page may hold a snapshot from
 * before a note was edited, so a line it asks for is checked against the
 * index as it is now, and each page accepts what its rows can name:
 *
 * - `entries` (Home): a task's line, an entry's first line, or line 1 of a
 *   note with no entries whose tags are all in its front matter.
 * - `graphNodes` (the Notes Graph): the same, where line 1 of a note with
 *   no entries also counts when the note links anywhere, since the graph
 *   draws such a note as a node.
 * - `tasks` (the Task Board): a task's line only.
 * - `notes` (Stats): an entry's first line, or any line of an indexed
 *   note, since Stats lists whole notes, such as one nothing links to.
 *
 * Under `entries` and `notes`, opening an entry's first line counts as a
 * visit to the entry; under the other two nothing is counted.
 */
export type SourcePolicy = 'entries' | 'graphNodes' | 'tasks' | 'notes';

/**
 * How a page finds the tag it was asked to open:
 *
 * - `lenient` (Stats, Home, a search page, Related Notes): as a reader may
 *   write it, without its marker, in other capitals, or with spaces around
 *   it, through `resolveIndexedTagKey`.
 * - `exact` (the Task Board, the Notes Graph): only by the key the index
 *   holds.
 */
export type TagPolicy = 'lenient' | 'exact';

/**
 * Where an open lands: the note and line to open, and the entry whose
 * visit it counts, if any; or `unknown` when the policy does not accept it.
 */
export type SourceLocation =
  | { kind: 'open'; filePath: string; line: number; visit?: string }
  | { kind: 'unknown' };

/** The tag an open names, by its key in the index; or `unknown`. */
export type TagLocation = { kind: 'open'; tagKey: string } | { kind: 'unknown' };

/** One policy's rule: where the line opens, if it may. */
type SourceRule = (index: WorkspaceIndex, filePath: string, line: number) => SourceLocation;

const UNKNOWN = { kind: 'unknown' } as const;

/** Whether a task sits on a line of a note. */
function taskAt(index: WorkspaceIndex, filePath: string, line: number): boolean {
  return [...index.tasks.values()].some((task) => task.filePath === filePath && task.lineNumber === line);
}

/** The entry that starts on a line of a note, if one does. */
function entryAt(index: WorkspaceIndex, filePath: string, line: number): { id: string; filePath: string; startLine: number } | undefined {
  return [...index.sections.values()].find((section) => section.filePath === filePath && section.startLine === line);
}

/** Opens the line asked for, counting a visit to `entry` when there is one. */
function openAt(filePath: string, line: number, entry?: { id: string }): SourceLocation {
  return { kind: 'open', filePath, line, ...(entry ? { visit: entry.id } : {}) };
}

const SOURCE_RULES: Record<SourcePolicy, SourceRule> = {
  entries: (index, filePath, line) => {
    const entry = entryAt(index, filePath, line);
    const taggedNote = [...index.files.values()].find(
      (file) =>
        file.filePath === filePath &&
        file.sections.length === 0 &&
        file.frontmatterTags.length > 0 &&
        line === 1,
    );
    if (!taskAt(index, filePath, line) && !entry && !taggedNote) {
      return UNKNOWN;
    }
    return openAt(filePath, line, entry);
  },
  graphNodes: (index, filePath, line) => {
    if (taskAt(index, filePath, line) || entryAt(index, filePath, line)) {
      return openAt(filePath, line);
    }
    const file = index.files.get(filePath);
    const isNode =
      file !== undefined &&
      file.sections.length === 0 &&
      (file.frontmatterTags.length > 0 || file.links.length > 0) &&
      line === 1;
    return isNode ? openAt(filePath, line) : UNKNOWN;
  },
  tasks: (index, filePath, line) => (taskAt(index, filePath, line) ? openAt(filePath, line) : UNKNOWN),
  notes: (index, filePath, line) => {
    const entry = entryAt(index, filePath, line);
    if (entry) {
      return openAt(entry.filePath, entry.startLine, entry);
    }
    return index.files.has(filePath) ? openAt(filePath, line) : UNKNOWN;
  },
};

const TAG_RULES: Record<TagPolicy, (index: WorkspaceIndex, tagKey: string) => string | undefined> = {
  lenient: (index, tagKey) => resolveIndexedTagKey(index.tags, tagKey),
  exact: (index, tagKey) => (index.tags.has(tagKey) ? tagKey : undefined),
};

/**
 * What a page's openSource and openTag may open. One method each, with the
 * page's policy as an argument, so the rules that differ from page to page
 * are named side by side here rather than written into each page's host.
 */
export class NavigationService {
  /**
   * Where a line a page asked to open lands under `policy`, read from
   * `index` as it is now; `unknown` when the policy does not accept it.
   */
  public resolveSourceLocation(
    index: WorkspaceIndex,
    filePath: string,
    line: number,
    policy: SourcePolicy,
  ): SourceLocation {
    return SOURCE_RULES[policy](index, filePath, line);
  }

  /** The tag a page asked to open, found in `index` under `policy`. */
  public resolveTag(index: WorkspaceIndex, tagKey: string, policy: TagPolicy): TagLocation {
    const found = TAG_RULES[policy](index, tagKey);
    return found === undefined ? UNKNOWN : { kind: 'open', tagKey: found };
  }
}
