import { isParkedFile } from '../../domain/index/parked';
import { countOtherCheckboxes } from '../../domain/index/otherCheckboxes';
import { isPeriodicNoteFile, stripTags } from '../../domain/markdown/parser';
import { findMissingLinkTargets, getBacklinkIndex, noteTitle } from '../../domain/index/backlinks';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';
import { getFileName } from '../../shared/paths';
import { baseCollator, defaultCollator } from './entryCards';
import { sectionIncludesTag, taskIncludesTag } from './tagMatching';
import { findTagMergeCandidates } from '../../domain/ranking/tagHygiene';
import { StatsAccessItem, DeckardStatsSnapshot, StatsTrend, StatsTagUsage, StatsTagPairs } from '../protocol/stats';
import { PersistedPreferences, TagInfo, WorkspaceIndex, TagMergeCandidate, UnreadableNote } from '../../domain/model';

/**
 * The Stats page: what the workspace holds, how it has grown week by week,
 * the tags used once or written together, the notes nothing links to, and
 * what the reader opens most.
 */

/**
 * Summarizes the current index and recorded local navigation for the Stats
 * page, with the notes that could not be read, its trends ending at `now`,
 * the moment the page asked at.
 */
export function createDeckardStatsSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  unreadable: readonly UnreadableNote[],
  now: number,
): DeckardStatsSnapshot {
  // Every pair, once: Stats lists the clearest, and a tag used once is
  // offered its lookalike from the same list.
  const lookalikes = findTagMergeCandidates(index, Number.MAX_SAFE_INTEGER);
  return {
    trends: createStatsTrends(index, now),
    updatedAt: index.updatedAt,
    builtAt: now,
    unreadable: unreadable.map((note) => ({
      ...note,
      open: { type: 'openSource', filePath: note.filePath, line: 1 },
    })),
    fileCount: index.files.size,
    sectionCount: index.sections.size,
    taskCount: index.tasks.size,
    activeTaskCount: [...index.tasks.values()].filter((task) => !task.completed)
      .length,
    tagCount: index.tags.size,
    entityCount: index.entities.size,
    wikiLinkCount: [...index.files.values()].reduce(
      (count, file) => count + file.links.length,
      0,
    ),
    ...(countOtherCheckboxes(index) > 0 ? { otherCheckboxes: countOtherCheckboxes(index) } : {}),
    tagViews: createAccessItems(preferences.tagAccessCounts, (tagKey) => {
      const tag = index.tags.get(tagKey);
      return tag
        ? {
            label: tag.label,
            detail: `${tag.count} indexed entries`,
            open: { type: 'openTag', tagKey },
          }
        : undefined;
    }),
    entityViews: createAccessItems(
      preferences.entityAccessCounts,
      (entityKey) => {
        const entity = index.entities.get(entityKey);
        return entity
          ? {
              label: entity.name,
              detail: `${entity.kind} / ${entity.count} indexed entries`,
              // Entities are keyed by the tag that names them.
              open: { type: 'openTag', tagKey: entityKey },
            }
          : undefined;
      },
    ),
    sectionViews: createAccessItems(
      preferences.sectionAccessCounts,
      (sectionId) => {
        const section = index.sections.get(sectionId);
        return section
          ? {
              label: stripTags(section.heading),
              detail: `${getFileName(section.filePath) ?? section.filePath} / line ${section.startLine}`,
              open: {
                type: 'openSource',
                filePath: section.filePath,
                line: section.startLine,
              },
            }
          : undefined;
      },
    ),
    ...findOrphanNotes(index),
    ...findLookalikeTags(lookalikes),
    tagUsage: createTagUsage(index, lookalikes.candidates),
    tagPairs: createTagPairs(index, TAG_PAIR_TAGS),
    ...listMissingLinkTargets(index),
    ...countParked(index),
  };
}

const TREND_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Twelve rolling seven-day spans: thirteen points, the last one now. */
const TREND_POINTS = 13;

/**
 * How the Notes, Tasks, and Open tasks totals stood at the end of each of
 * the last twelve rolling weeks, ending at `now`, rebuilt from today's
 * notes: an entry counts from its note's date, a task is open from then
 * until its ✅ date, or its note's last change when it has none. Deleted
 * notes are gone from past weeks too, and an entry added to an old note
 * counts from that note's date. One pass over the entries; each adds where
 * it starts, and a done task takes itself away where it ends.
 */
export function createStatsTrends(
  index: WorkspaceIndex,
  now: number,
): DeckardStatsSnapshot['trends'] {
  const last = TREND_POINTS - 1;
  /** The first point at which something dated `at` exists; undated, always. */
  const firstPoint = (at: number | undefined): number => {
    if (at === undefined || !Number.isFinite(at)) {
      return 0;
    }
    if (at > now) {
      return last;
    }
    return Math.max(0, last - Math.floor((now - at) / TREND_WEEK));
  };
  const notes = new Array<number>(TREND_POINTS + 1).fill(0);
  const tasks = new Array<number>(TREND_POINTS + 1).fill(0);
  const open = new Array<number>(TREND_POINTS + 1).fill(0);
  index.sections.forEach((section) => {
    notes[firstPoint(section.createdAt)] += 1;
  });
  index.tasks.forEach((task) => {
    const start = firstPoint(task.createdAt);
    tasks[start] += 1;
    if (!task.completed) {
      open[start] += 1;
      return;
    }
    const doneAt = task.doneAt ?? task.updatedAt ?? index.files.get(task.filePath)?.updatedAt;
    if (doneAt === undefined) {
      // Done, and no date says when: it is counted open in no past week.
      return;
    }
    const end = Math.max(start, doneAt > now ? last : Math.max(0, last - Math.floor((now - doneAt) / TREND_WEEK)));
    open[start] += 1;
    open[end] -= 1;
  });
  const levels = (starts: number[], total: number): StatsTrend => {
    const points: number[] = [];
    let running = 0;
    for (let point = 0; point < TREND_POINTS; point += 1) {
      running += starts[point];
      points.push(running);
    }
    // The last point is the total on the tile, so the two always agree.
    points[last] = total;
    return { points, change: points[last] - points[last - 1] };
  };
  return {
    notes: levels(notes, index.sections.size),
    tasks: levels(tasks, index.tasks.size),
    openTasks: levels(open, [...index.tasks.values()].filter((task) => !task.completed).length),
  };
}

/** How many notes and open tasks are parked, when any are. */
function countParked(index: WorkspaceIndex): Pick<DeckardStatsSnapshot, 'parked'> {
  const parked = index.parked;
  if (!parked || (parked.sections.size === 0 && parked.tasks.size === 0 && parked.files.size === 0)) {
    return {};
  }
  let openTasks = 0;
  parked.tasks.forEach((id) => {
    if (index.tasks.get(id)?.completed === false) {
      openTasks += 1;
    }
  });
  // A note is parked when it is parked whole, or holds a parked entry.
  const notes = new Set(parked.files);
  parked.sections.forEach((id) => {
    const section = index.sections.get(id);
    if (section) {
      notes.add(section.filePath);
    }
  });
  return { parked: { notes: notes.size, openTasks } };
}

/** How many of the names that open no note the Stats page lists. */
const MISSING_LINK_LIMIT = 50;

/** The names links write that open no note, most linked first. */
function listMissingLinkTargets(
  index: WorkspaceIndex,
): Pick<DeckardStatsSnapshot, 'missingLinkTargets' | 'missingLinkTargetCount'> {
  const missing = findMissingLinkTargets(index);
  return {
    missingLinkTargetCount: missing.length,
    missingLinkTargets: missing.slice(0, MISSING_LINK_LIMIT).map((target) => ({
      name: target.name,
      count: target.count,
      sources: target.sourcePaths.slice(0, 3).map((filePath) => noteTitle(filePath)),
      sourceCount: target.sourcePaths.length,
      creatable: getExtractedNoteFileName(target.name) !== undefined,
    })),
  };
}

/** How many of the tags that look alike the Stats page names. */
const LOOKALIKE_TAG_LIMIT = 12;

/** Tags that look like two spellings of one idea, the clearest pairs first. */
function findLookalikeTags(
  { candidates, total }: { candidates: TagMergeCandidate[]; total: number },
): Pick<DeckardStatsSnapshot, 'lookalikeTags' | 'lookalikeTagCount'> {
  return { lookalikeTags: candidates.slice(0, LOOKALIKE_TAG_LIMIT), lookalikeTagCount: total };
}

/** How many of the most-used tags Tags written together pairs. */
const TAG_PAIR_TAGS = 12;

/**
 * How often the `limit` most-used tags are written on the same note or
 * task, as a search for both would find them: a tag a heading carries is
 * on the entries under it. Only those tags are counted, so twelve tags are
 * sixty-six pairs, whatever the workspace holds.
 */
export function createTagPairs(index: WorkspaceIndex, limit = TAG_PAIR_TAGS): StatsTagPairs {
  const tags = [...index.tags.values()]
    .filter((tag) => tag.count > 0)
    .sort((left, right) => right.count - left.count || baseCollator.compare(left.label, right.label))
    .slice(0, limit);
  const pairs = tags.map(() => tags.map(() => 0));
  const count = (has: (key: string) => boolean): void => {
    const carried: number[] = [];
    tags.forEach((tag, position) => {
      if (has(tag.key)) {
        carried.push(position);
      }
    });
    for (let left = 0; left < carried.length; left += 1) {
      for (let right = left + 1; right < carried.length; right += 1) {
        pairs[carried[left]][carried[right]] += 1;
      }
    }
  };
  index.sections.forEach((section) => count((key) => sectionIncludesTag(index, section, key)));
  index.tasks.forEach((task) => count((key) => taskIncludesTag(index, task, key)));
  return {
    tags: tags.map((tag): [string, string, number] => [tag.key, tag.label, tag.count]),
    pairs,
  };
}

/** The bands of how often a tag is used: once, twice, 3–5, 6–10, 11–25, 26 or more. */
const TAG_USE_BANDS: readonly { label: string; min: number; max?: number }[] = [
  { label: 'Used once', min: 1, max: 1 },
  { label: 'Used twice', min: 2, max: 2 },
  { label: 'Used 3–5 times', min: 3, max: 5 },
  { label: 'Used 6–10 times', min: 6, max: 10 },
  { label: 'Used 11–25 times', min: 11, max: 25 },
  { label: 'Used 26 or more times', min: 26 },
];

/** How many of the tags used once Stats lists. */
const USED_ONCE_LIMIT = 100;

/**
 * How many tags are used how often, by the entries that carry them, and
 * the tags used once — the likeliest typos and one-offs — each with the tag
 * it looks like when there is one, so it can be merged there.
 */
export function createTagUsage(
  index: WorkspaceIndex,
  candidates: readonly TagMergeCandidate[] = findTagMergeCandidates(index, Number.MAX_SAFE_INTEGER).candidates,
): StatsTagUsage {
  const bands = TAG_USE_BANDS.map((band) => ({ ...band, count: 0 }));
  const once: TagInfo[] = [];
  index.tags.forEach((tag) => {
    if (tag.count < 1) {
      return;
    }
    const band = bands.find((candidate) => tag.count >= candidate.min && (candidate.max === undefined || tag.count <= candidate.max));
    if (band) {
      band.count += 1;
    }
    if (tag.count === 1) {
      once.push(tag);
    }
  });
  const lookalike = new Map<string, { key: string; label: string }>();
  candidates.forEach((candidate) => {
    if (!lookalike.has(candidate.sourceKey)) {
      lookalike.set(candidate.sourceKey, { key: candidate.targetKey, label: candidate.targetLabel });
    }
  });
  const usedOnce = once
    .sort((left, right) => baseCollator.compare(left.label, right.label))
    .slice(0, USED_ONCE_LIMIT)
    .map((tag) => {
      const like = lookalike.get(tag.key);
      return like ? { key: tag.key, label: tag.label, lookalike: like } : { key: tag.key, label: tag.label };
    });
  return { bands, usedOnce, usedOnceCount: once.length };
}

/** How many of the notes nothing links to the Stats page names. */
const ORPHAN_NOTE_LIMIT = 50;

/**
 * Notes no other note links to, by title. Daily, weekly, and monthly notes are
 * left out, since they are found by their date rather than through links.
 */
function findOrphanNotes(
  index: WorkspaceIndex,
): Pick<DeckardStatsSnapshot, 'orphanNotes' | 'orphanNoteCount'> {
  const backlinks = getBacklinkIndex(index);
  const orphans = [...index.files.values()]
    .filter(
      (file) =>
        backlinks.toNote(file.filePath).length === 0 &&
        !isPeriodicNoteFile(file) &&
        // An archive is expected to be unlinked.
        !isParkedFile(index, file.filePath),
    )
    .map((file) => ({ filePath: file.filePath, title: noteTitle(file.filePath) }))
    .sort(
      (left, right) =>
        baseCollator.compare(left.title, right.title) ||
        defaultCollator.compare(left.filePath, right.filePath),
    );
  return {
    orphanNoteCount: orphans.length,
    orphanNotes: orphans
      .slice(0, ORPHAN_NOTE_LIMIT)
      .map(({ filePath, title }) => ({
        label: title,
        detail: filePath,
        open: { type: 'openSource' as const, filePath, line: 1 },
      })),
  };
}

/**
 * Joins persisted counters to current index entries and returns the top ten.
 */
function createAccessItems(
  counts: Record<string, number>,
  getItem: (key: string) => Omit<StatsAccessItem, 'count'> | undefined,
): StatsAccessItem[] {
  return Object.entries(counts)
    .map(([key, count]) => {
      const item = getItem(key);
      return item ? { ...item, count } : undefined;
    })
    .filter((item): item is StatsAccessItem => item !== undefined)
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, undefined, {
          sensitivity: 'base',
        }),
    )
    .slice(0, 10);
}
