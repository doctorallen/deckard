import {
  isParkedFile,
  isParkedOnlyTag,
  isParkedSection,
  isParkedTask,
} from '../../domain/index/parked';
import { stripTags } from '../../domain/markdown/parser';
import { getFileName } from '../../shared/paths';
import { getPlainTextTerms } from '../../domain/query/queryEdit';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import {
  collectQueryTagKeys,
  visitConditions,
} from '../../domain/query/queryFormat';
import { parseQuery } from '../../domain/query/queryParser';
import { QueryNode, QuerySuggestion } from '../../domain/query/queryTypes';
import { EntrySearchResult } from '../../core/storage/searchStore';
import {
  ParsedFile,
  PersistedPreferences,
  Section,
  TagInfo,
  Task,
  WorkspaceIndex,
} from '../../core/types';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { describeTagMatches, getHeadingPath } from './dashboardState';
import { frecencyScore } from './frecency';
import { createPinForLine, findPinnedSection, resolvePin } from './pinnedNotes';
import { normalizeFindInput, pinKey } from '../../core/storage/preferences';

/**
 * Ranks what Quick Find shows for what has been typed so far.
 *
 * The input is a Deckard query, so `#tag`, `is:open`, and `in:folder` narrow
 * the results exactly as they do anywhere else, while plain words are
 * searched as text. Results come in explainable tiers rather than one opaque
 * score: an exact title first, then titles that contain every word or match
 * it loosely, then entries whose body matches, ranked by the full-text index.
 * How often and how recently something was opened breaks ties.
 */
export type QuickFindItemKind =
  | 'tag'
  | 'condition'
  | 'recent'
  | 'savedView'
  | 'note'
  | 'task'
  | 'message';

export interface QuickFindItem {
  kind: QuickFindItemKind;
  label: string;
  description?: string;
  detail?: string;
  tagKey?: string;
  filePath?: string;
  line?: number;
  sectionId?: string;
  completed?: boolean;
  /** A note pinned to Home, listed first in an empty Find. */
  pinned?: boolean;
  /** A task row's task. */
  taskId?: string;
  /** The query a recent search or saved view stands for. */
  query?: string;
  savedFilterId?: string;
  /**
   * The whole search after choosing this item with Tab: the word being typed
   * replaced by a tag or condition, or a recent search in full.
   */
  completion?: string;
}

export interface QuickFindResults {
  /** Pinned notes, offered first before anything is typed. */
  pinned?: QuickFindItem[];
  tags: QuickFindItem[];
  conditions: QuickFindItem[];
  recent: QuickFindItem[];
  savedViews: QuickFindItem[];
  notes: QuickFindItem[];
  tasks: QuickFindItem[];
  /** A parse error, or why the matches are only partial. */
  message?: string;
  /** The search with a misspelled word corrected. */
  suggestion?: string;
  /** Every match, before the lists above were cut short. */
  totals: { notes: number; tasks: number };
  /**
   * What was typed, and the line Capture would write, when Find found
   * nothing that has every word and the words read as something to do.
   */
  capture?: { text: string; line: string };
}

export type QuickFindTextSearch = (text: string) => EntrySearchResult;

export interface QuickFindOptions {
  /**
   * The settings and moment Find answers in: what its searches find, and how
   * recently a remembered choice was made.
   */
  queryContext: QueryContext;
  noteLimit?: number;
  taskLimit?: number;
  /** Whole conditions to offer for the word being typed, such as `is:open`. */
  conditions?: readonly QuerySuggestion[];
  /** Writes typed words as Capture would, for Find's Capture row. */
  formatCapture?: (text: string) => string;
}

const TAG_LIMIT = 5;
const CONDITION_LIMIT = 4;
const SAVED_VIEW_LIMIT = 3;
const EMPTY_LIST_LIMIT = 8;
/** How many pinned notes, and how many notes opened last, empty Find lists. */
const EMPTY_PINNED_LIMIT = 10;
const EMPTY_RECENT_LIMIT = 5;

/** Tier floors. A higher tier always outranks a lower one. */
const EXACT_TITLE = 3000;
const TITLE_HAS_EVERY_WORD = 2000;
const LOOSE_TITLE = 1000;
const QUERY_MATCH = 500;

export function buildQuickFindResults(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  input: string,
  searchText: QuickFindTextSearch,
  options: QuickFindOptions,
): QuickFindResults {
  const { now } = options.queryContext;
  if (!input.trim()) {
    return buildEmptyResults(index, preferences, now);
  }

  const token = getTrailingToken(input);
  const beforeToken = input.slice(0, input.length - token.length);
  // A `#` or `@` word that is not yet a whole tag is still being typed, so it
  // completes to tags rather than narrowing the results to nothing.
  const tagToken =
    /^-?[#@]/.test(token) &&
    !resolveIndexedTagKey(index.tags, token.replace(/^-/, ''))
      ? token.replace(/^-/, '')
      : undefined;

  let parsed = parseQuery(tagToken ? beforeToken : input);
  let message: string | undefined;
  if (!parsed.node && parsed.diagnostics.length > 0) {
    // The last word is usually the unfinished part, so the rest of the
    // search keeps its results while it is typed.
    const withoutToken = parseQuery(beforeToken);
    if (withoutToken.node || !beforeToken.trim()) {
      parsed = withoutToken;
    } else {
      message = parsed.diagnostics[0].message;
    }
  }

  const conditions = matchConditions(token, options.conditions ?? [], beforeToken);
  const tags = matchTags(
    index,
    preferences,
    tagToken ?? (isBareWord(token) ? token : ''),
    new Set(collectQueryTagKeys(parsed.node)),
    tagToken || isBareWord(token) ? beforeToken : input,
    now,
    learnedWeights(preferences, input, now),
  );
  const savedViews = matchSavedViews(index, preferences, input.trim());

  const results: QuickFindResults = {
    tags,
    conditions,
    recent: [],
    savedViews,
    notes: [],
    tasks: [],
    message,
    totals: { notes: 0, tasks: 0 },
  };
  if (!parsed.node) {
    return results;
  }

  const learned = learnedBonuses(index, preferences, input, now);
  const ranked = rankEntries(index, preferences, parsed.node, searchText, options.queryContext, learned);
  results.message ??= ranked.partial
    ? 'No entry has every word, so these have some of them.'
    : undefined;
  results.suggestion = ranked.suggestion
    ? correctInput(input, ranked.searched, ranked.suggestion)
    : undefined;
  results.totals = {
    notes: ranked.notes.length,
    tasks: ranked.tasks.length,
  };
  // Nothing had every word: what was typed may be something to do rather
  // than something to find.
  if (
    options.formatCapture &&
    isCaptureable(parsed.node) &&
    (ranked.notes.length + ranked.tasks.length === 0 || ranked.partial)
  ) {
    const text = input.trim();
    results.capture = { text, line: options.formatCapture(text) };
  }
  results.notes = ranked.notes
    .slice(0, options.noteLimit ?? 30)
    .map((entry) => entry.item);
  results.tasks = ranked.tasks
    .slice(0, options.taskLimit ?? 15)
    .map((entry) => entry.item);
  return results;
}

interface RankedEntry {
  score: number;
  updatedAt: number;
  item: QuickFindItem;
  /** Parked entries rank after every unparked one, whatever their score. */
  parked?: boolean;
}

/** An entry that is parked, said at the end of its description. */
function parkedItem(item: QuickFindItem, parked: boolean): QuickFindItem {
  return parked ? { ...item, description: `${item.description ?? ''} · Parked` } : item;
}

/**
 * Finds and orders the note entries and tasks a parsed search matches.
 *
 * A search of plain words asks the full-text index, which is fast and ranks
 * by relevance; a search with any other condition is answered by the query
 * evaluator, so it means exactly what it means everywhere else, and its words
 * only order the results. The evaluation, and the frecency of each entry,
 * are the context's.
 */
function rankEntries(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  node: QueryNode,
  searchText: QuickFindTextSearch,
  context: QueryContext,
  learned: ReadonlyMap<string, number> = new Map(),
): {
  notes: RankedEntry[];
  tasks: RankedEntry[];
  partial: boolean;
  suggestion?: string;
  /** The words sent to the text index. */
  searched: string;
} {
  const plainTerms = getPlainTextTerms(node);
  const words = plainTerms ?? getTextValues(node);
  const text = words.length > 0 ? searchText(words.join(' ')) : undefined;
  const bestScore = Math.max(
    0,
    ...(text?.matches.map((match) => match.score) ?? []),
  );
  const textScores = new Map<string, { score: number; excerpt: string }>();
  text?.matches.forEach((match) =>
    textScores.set(match.id, {
      // Relevance is scaled within the search, so it orders entries inside a
      // tier without ever lifting one into the tier above.
      score: bestScore > 0 ? (match.score / bestScore) * 100 : 0,
      excerpt: match.excerpt,
    }),
  );

  let sections: Section[];
  let tasks: Task[];
  let files: ParsedFile[];
  if (plainTerms) {
    // Titles are searched here as well as in the index, so a title matched
    // loosely, as with a typo or an abbreviation, is still found.
    const matchedIds = new Set(textScores.keys());
    sections = [...index.sections.values()].filter(
      (section) =>
        matchedIds.has(section.id) ||
        scoreTitle(plainTerms, stripTags(section.heading)) > 0,
    );
    tasks = [...index.tasks.values()].filter(
      (task) =>
        matchedIds.has(task.id) || scoreTitle(plainTerms, stripTags(task.title)) > 0,
    );
    files = [...index.files.values()].filter(
      (file) =>
        file.sections.length === 0 &&
        (matchedIds.has(file.filePath) ||
          scoreTitle(plainTerms, getFileName(file.filePath)) > 0),
    );
  } else {
    const results = evaluateQuery(index, node, context);
    sections = results.sections;
    tasks = results.tasks;
    files = results.files;
  }

  const base = plainTerms ? 0 : QUERY_MATCH;
  const noteEntries: RankedEntry[] = [
    ...sections.map((section) => {
      const title = stripTags(section.heading) || getFileName(section.filePath);
      const found = textScores.get(section.id);
      const titleScore = scoreTitle(words, title);
      return {
        score: withLearned(
          base +
            titleScore +
            (found?.score ?? 0) +
            frecencyBonus(preferences, section.id, context.now),
          learned.get(section.id),
          titleScore,
        ),
        updatedAt: section.updatedAt ?? 0,
        parked: isParkedSection(index, section.id),
        item: parkedItem(
          createSectionItem(index, section, title, found?.excerpt),
          isParkedSection(index, section.id),
        ),
      };
    }),
    ...files.map((file) => {
      const title = getFileName(file.filePath);
      const found = textScores.get(file.filePath);
      const titleScore = scoreTitle(words, title);
      return {
        score: withLearned(
          base + titleScore + (found?.score ?? 0),
          learned.get(file.filePath),
          titleScore,
        ),
        updatedAt: file.updatedAt ?? 0,
        parked: isParkedFile(index, file.filePath),
        item: parkedItem(
          {
            kind: 'note' as const,
            label: title,
            description: file.filePath,
            detail: cleanExcerpt(found?.excerpt) ?? firstLine(file.content),
            filePath: file.filePath,
            line: 1,
          },
          isParkedFile(index, file.filePath),
        ),
      };
    }),
  ].sort(compareRanked);

  const taskEntries: RankedEntry[] = tasks
    .map((task) => {
      const title = stripTags(task.title) || task.title;
      const found = textScores.get(task.id);
      const titleScore = scoreTitle(words, title);
      return {
        // An open task is usually the one being looked for.
        score: withLearned(
          base + titleScore + (found?.score ?? 0) + (task.completed ? 0 : 20),
          learned.get(task.id),
          titleScore,
        ),
        updatedAt: task.updatedAt ?? 0,
        parked: isParkedTask(index, task.id),
        item: parkedItem(createTaskItem(index, task, title), isParkedTask(index, task.id)),
      };
    })
    .sort(compareRanked);

  return {
    notes: noteEntries,
    tasks: taskEntries,
    partial: text?.partial ?? false,
    suggestion: text?.suggestion,
    searched: words.join(' '),
  };
}

/**
 * Adds what Find learned to an entry's score. One pick lifts an entry past
 * loose matches, three past titles holding every word, and nothing learned
 * ever lifts one past a title that is exactly what was typed.
 */
function withLearned(score: number, weight: number | undefined, titleScore: number): number {
  if (!weight) {
    return score;
  }
  // One pick is worth more than a loose title match (about 1,100), three
  // more than a title holding every word (about 2,400).
  const lifted = score + Math.min(2800, 300 + 900 * weight);
  return titleScore === EXACT_TITLE ? lifted : Math.min(lifted, EXACT_TITLE - 1);
}

/** How long a Find choice takes to count half as much. */
const FIND_CHOICE_HALF_LIFE_DAYS = 30;

/**
 * How much each remembered result weighs for what is typed now. A choice
 * counts when what was typed then starts with what is typed now, as
 * Firefox's adaptive history has it: picking Vendor contract after `vend`
 * lifts it for `v`, `ve`, and `ven` too. Keyed by the choice's key.
 */
export function learnedWeights(
  preferences: PersistedPreferences,
  input: string,
  now: number,
): Map<string, number> {
  const typed = normalizeFindInput(input);
  const weights = new Map<string, number>();
  if (!typed) {
    return weights;
  }
  (preferences.findChoices ?? []).forEach((choice) => {
    if (!choice.input.startsWith(typed)) {
      return;
    }
    const ageDays = Math.max(0, (now - choice.at) / (24 * 60 * 60 * 1000));
    const weight = choice.count * 0.5 ** (ageDays / FIND_CHOICE_HALF_LIFE_DAYS);
    weights.set(choice.key, (weights.get(choice.key) ?? 0) + weight);
  });
  return weights;
}

/**
 * The learned weights, resolved to the entries they name now: a note's
 * heading found again by its text, a task by its words.
 */
function learnedBonuses(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  input: string,
  now: number,
): Map<string, number> {
  const resolved = new Map<string, number>();
  learnedWeights(preferences, input, now).forEach((weight, key) => {
    const id = resolveFindChoiceKey(index, key);
    if (id !== undefined) {
      resolved.set(id, (resolved.get(id) ?? 0) + weight);
    }
  });
  return resolved;
}

function resolveFindChoiceKey(index: WorkspaceIndex, key: string): string | undefined {
  const kind = key.slice(0, key.indexOf(':'));
  if (kind !== 'note' && kind !== 'task') {
    return undefined;
  }
  let parts: unknown;
  try {
    parts = JSON.parse(key.slice(kind.length + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parts) || typeof parts[0] !== 'string') {
    return undefined;
  }
  const file = index.files.get(parts[0]);
  if (!file) {
    return undefined;
  }
  if (kind === 'task') {
    return file.tasks.find((task) => stripTags(task.title) === parts[1])?.id;
  }
  if (!parts[1]) {
    return file.filePath;
  }
  return findPinnedSection(file.sections, {
    filePath: file.filePath,
    heading: String(parts[1]),
    occurrence: Number(parts[2]) || 0,
  })?.id;
}

/**
 * A result as Find remembers it was chosen: by what it is, so a heading
 * that moves down its note, or a task whose line changes, is still known.
 */
export function findChoiceKey(index: WorkspaceIndex, item: QuickFindItem): string | undefined {
  switch (item.kind) {
    case 'note': {
      if (!item.filePath || !item.line) {
        return undefined;
      }
      const pin = createPinForLine(index, item.filePath, item.line);
      return pin ? `note:${pinKey(pin)}` : undefined;
    }
    case 'task':
      return item.filePath ? `task:${JSON.stringify([item.filePath, item.label])}` : undefined;
    case 'tag':
      return item.tagKey ? `tag:${item.tagKey}` : undefined;
    case 'savedView':
      return item.savedFilterId ? `view:${item.savedFilterId}` : undefined;
    default:
      return undefined;
  }
}

/**
 * Applies a spelling correction of the searched words to everything that
 * was typed, so tags and conditions around a corrected word are kept.
 */
function correctInput(input: string, searched: string, corrected: string): string {
  const before = searched.split(/\s+/);
  const after = corrected.split(/\s+/);
  return before.reduce((text, word, index) => {
    const replacement = after[index];
    if (!replacement || replacement.toLowerCase() === word.toLowerCase()) {
      return text;
    }
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
      'iu',
    );
    return text.replace(pattern, (_, prefix: string) => `${prefix}${replacement}`);
  }, input);
}

function compareRanked(left: RankedEntry, right: RankedEntry): number {
  return (
    Number(left.parked === true) - Number(right.parked === true) ||
    right.score - left.score ||
    right.updatedAt - left.updatedAt ||
    left.item.label.localeCompare(right.item.label)
  );
}

/**
 * Scores a title against the words searched for. Zero means the title does
 * not match; any other score places it in one of the title tiers.
 */
export function scoreTitle(words: readonly string[], title: string): number {
  if (words.length === 0) {
    return 0;
  }
  const normalizedTitle = title.toLowerCase();
  const phrase = words.join(' ').toLowerCase();
  if (normalizedTitle === phrase) {
    return EXACT_TITLE;
  }
  if (words.every((word) => normalizedTitle.includes(word.toLowerCase()))) {
    return (
      TITLE_HAS_EVERY_WORD +
      (normalizedTitle.startsWith(phrase) ? 200 : 0) +
      // A shorter title is closer to exactly what was typed.
      Math.max(0, 100 - normalizedTitle.length)
    );
  }
  if (words.length === 1 && words[0].length >= 2) {
    const loose = fuzzyScore(words[0], title);
    // A loose match has to be good to count at all, or every long title
    // would match every short word.
    if (loose !== undefined && loose >= words[0].length * 6) {
      return LOOSE_TITLE + loose;
    }
  }
  return 0;
}

/**
 * Scores the characters of `query` appearing in order in `target`, the way
 * a fuzzy finder does: runs of adjacent characters and characters that start
 * a word count most. Returns undefined when they do not all appear.
 */
export function fuzzyScore(query: string, target: string): number | undefined {
  const wanted = query.toLowerCase();
  const text = target.toLowerCase();
  if (!wanted) {
    return 0;
  }
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const character of wanted) {
    const found = text.indexOf(character, from);
    if (found < 0) {
      return undefined;
    }
    const startsWord = found === 0 || /[\s/#@_\-.:]/.test(text[found - 1]);
    score +=
      1 + (found === previous + 1 ? 5 : 0) + (startsWord ? 8 : 0) -
      Math.min(3, found - from);
    previous = found;
    from = found + 1;
  }
  if (text.startsWith(wanted)) {
    score += 15;
  } else if (text.includes(wanted)) {
    score += 10;
  }
  return score;
}

function frecencyBonus(
  preferences: PersistedPreferences,
  sectionId: string,
  now: number,
): number {
  return Math.min(
    60,
    frecencyScore(
      preferences.sectionAccessCounts[sectionId] ?? 0,
      preferences.sectionAccessTimes?.[sectionId],
      now,
    ) * 15,
  );
}

function tagFrecency(
  preferences: PersistedPreferences,
  tagKey: string,
  now: number,
): number {
  return frecencyScore(
    preferences.tagAccessCounts[tagKey] ?? 0,
    preferences.tagAccessTimes?.[tagKey],
    now,
  );
}

/**
 * Tags that match the word being typed, best first. A tag's last segment
 * counts most, so `atlas` finds `#project/atlas`.
 */
function matchTags(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  word: string,
  excluded: ReadonlySet<string>,
  prefix: string,
  now: number,
  learned: ReadonlyMap<string, number> = new Map(),
): QuickFindItem[] {
  const wanted = word.replace(/^[#@]/, '').toLowerCase();
  if (wanted.length === 0) {
    return [];
  }
  return [...index.tags.values()]
    .filter((tag) => !excluded.has(tag.key))
    .flatMap((tag) => {
      const bare = tag.key.replace(/^[#@]/, '');
      const leaf = bare.slice(bare.lastIndexOf('/') + 1);
      const leafScore = leaf.startsWith(wanted)
        ? 100
        : fuzzyScore(wanted, leaf) ?? -1;
      const keyScore = fuzzyScore(wanted, bare);
      if (keyScore === undefined && leafScore < 0) {
        return [];
      }
      const score =
        Math.max(leafScore, keyScore ?? 0) +
        (preferences.favoriteTags.includes(tag.key) ? 20 : 0) +
        tagFrecency(preferences, tag.key, now) * 10 +
        Math.log2(1 + tag.count) +
        Math.min(150, 50 * (learned.get(`tag:${tag.key}`) ?? 0));
      return [{ tag, score, parked: isParkedOnlyTag(index, tag.key) }];
    })
    .sort(
      (left, right) =>
        Number(left.parked) - Number(right.parked) ||
        right.score - left.score ||
        left.tag.label.localeCompare(right.tag.label),
    )
    .slice(0, TAG_LIMIT)
    .map(({ tag }) => createTagItem(index, tag, `${prefix}${tag.key} `));
}

/**
 * Whole conditions for the word being typed. A value finds its condition,
 * so `overdue` offers `is:overdue` and `open` offers `is:open`.
 */
function matchConditions(
  token: string,
  conditions: readonly QuerySuggestion[],
  prefix: string,
): QuickFindItem[] {
  const wanted = token.toLowerCase();
  if (wanted.length < 2 || /^[#@"']/.test(wanted)) {
    return [];
  }
  return conditions
    .filter((condition) => {
      const label = condition.label.toLowerCase();
      const value = label.slice(label.indexOf(':') + 1);
      return (
        label !== wanted &&
        (label.startsWith(wanted) || (label.includes(':') && value.startsWith(wanted)))
      );
    })
    .slice(0, CONDITION_LIMIT)
    .map((condition) => ({
      kind: 'condition' as const,
      label: condition.label,
      description: condition.detail,
      completion: `${prefix}${condition.value} `,
    }));
}

function matchSavedViews(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  text: string,
): QuickFindItem[] {
  return preferences.savedFilters
    .flatMap((filter) => {
      const score = fuzzyScore(text, filter.name);
      return score === undefined || score < text.length * 4
        ? []
        : [{ filter, score }];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, SAVED_VIEW_LIMIT)
    .map(({ filter }) => createSavedViewItem(index, filter));
}

/**
 * What Quick Find offers before anything is typed: pinned notes, the notes
 * opened last, recent searches, saved searches, and the tags most likely to
 * be wanted.
 */
function buildEmptyResults(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  now: number,
): QuickFindResults {
  const pinnedSectionIds = new Set<string>();
  const pinnedFiles = new Set<string>();
  const pinned = (preferences.pinnedNotes ?? [])
    .flatMap((pin): QuickFindItem[] => {
      const resolved = resolvePin(index, pin);
      if (!resolved) {
        return [];
      }
      const file = index.files.get(pin.filePath);
      const section = pin.heading && file ? findPinnedSection(file.sections, pin) : undefined;
      if (section) {
        pinnedSectionIds.add(section.id);
      } else if (!pin.heading) {
        pinnedFiles.add(pin.filePath);
      }
      const missing = resolved.detail.endsWith('heading not found');
      return [
        {
          kind: 'note',
          label: resolved.title,
          description: `Pinned · ${getFileName(pin.filePath)}`,
          ...(missing ? { detail: 'heading not found' } : {}),
          filePath: resolved.filePath,
          line: resolved.line,
          ...(section ? { sectionId: section.id } : {}),
          pinned: true,
        },
      ];
    })
    .slice(0, EMPTY_PINNED_LIMIT);
  const recent = (preferences.recentQueries ?? [])
    .slice(0, EMPTY_RECENT_LIMIT)
    .map((query) => ({
      kind: 'recent' as const,
      label: query,
      query,
      completion: `${query} `,
    }));
  const tags = [...index.tags.values()]
    .map((tag) => ({
      tag,
      score:
        (preferences.favoriteTags.includes(tag.key) ? 100 : 0) +
        tagFrecency(preferences, tag.key, now),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.tag.label.localeCompare(right.tag.label),
    )
    .slice(0, EMPTY_LIST_LIMIT)
    .map(({ tag }) => createTagItem(index, tag, `${tag.key} `));
  const savedViews = preferences.savedFilters.map((filter) =>
    createSavedViewItem(index, filter),
  );
  const notes = Object.entries(preferences.sectionAccessTimes ?? {})
    .sort((left, right) => right[1] - left[1])
    .flatMap(([sectionId]) => {
      const section = index.sections.get(sectionId);
      return section && !pinnedSectionIds.has(sectionId) && !pinnedFiles.has(section.filePath)
        ? [
            createSectionItem(
              index,
              section,
              stripTags(section.heading) || getFileName(section.filePath),
            ),
          ]
        : [];
    })
    .slice(0, EMPTY_RECENT_LIMIT);
  return {
    pinned,
    tags,
    conditions: [],
    recent,
    savedViews,
    notes,
    tasks: [],
    totals: { notes: 0, tasks: 0 },
  };
}

function createTagItem(
  index: WorkspaceIndex,
  tag: TagInfo,
  completion: string,
): QuickFindItem {
  return {
    kind: 'tag',
    label: tag.label,
    description: describeTagMatches(index, tag.key),
    tagKey: tag.key,
    completion,
  };
}

function createSavedViewItem(
  index: WorkspaceIndex,
  filter: PersistedPreferences['savedFilters'][number],
): QuickFindItem {
  const query =
    filter.query ??
    filter.tagKeys
      .map((tagKey) => index.tags.get(tagKey)?.label ?? tagKey)
      .join(' ');
  return {
    kind: 'savedView',
    label: filter.name,
    description: query,
    query,
    savedFilterId: filter.id,
    completion: `${query} `,
  };
}

function createSectionItem(
  index: WorkspaceIndex,
  section: Section,
  title: string,
  excerpt?: string,
): QuickFindItem {
  const parents = getHeadingPath(section, index.sections).slice(0, -1);
  let body = cleanExcerpt(excerpt);
  // An excerpt of a section's first words repeats its heading, shown above.
  if (body?.startsWith(section.heading)) {
    body = body.slice(section.heading.length).trim() || undefined;
  }
  const detail = [parents.join(' › '), body ?? firstLine(section.rawContent, section.heading)]
    .filter(Boolean)
    .join(' — ');
  return {
    kind: 'note',
    label: title,
    description: getFileName(section.filePath),
    detail: detail || undefined,
    filePath: section.filePath,
    line: section.startLine,
    sectionId: section.id,
  };
}

function createTaskItem(
  index: WorkspaceIndex,
  task: Task,
  title: string,
): QuickFindItem {
  const section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  const facts = [
    task.dueText ? `due ${task.dueText}` : undefined,
    task.priority ? `${task.priority} priority` : undefined,
    section ? getHeadingPath(section, index.sections).join(' › ') : undefined,
  ].filter(Boolean);
  return {
    kind: 'task',
    label: title,
    description: getFileName(task.filePath),
    detail: facts.length ? facts.join(' · ') : undefined,
    filePath: task.filePath,
    line: task.lineNumber,
    // The heading the task is under, which a link to it names.
    ...(section ? { sectionId: section.id } : {}),
    taskId: task.id,
    completed: task.completed,
  };
}

/**
 * Whether a search reads as words to capture: plain words, with tags and
 * people among them, and nothing else — no `is:`, `in:`, dates, OR, NOT, or
 * parentheses — and at least one word.
 */
export function isCaptureable(node: QueryNode): boolean {
  let words = 0;
  const plain = (current: QueryNode): boolean => {
    if (current.type === 'and') {
      return current.children.every(plain);
    }
    if (current.type !== 'condition') {
      return false;
    }
    if (current.field === 'text' && current.operator === 'contains') {
      words += 1;
      return true;
    }
    return current.field === 'tag' && current.operator === 'eq';
  };
  return plain(node) && words > 0;
}

/** Every word a search looks for, used only to order its results. */
function getTextValues(node: QueryNode): string[] {
  const values: string[] = [];
  visitConditions(node, (condition) => {
    if (
      condition.field === 'text' &&
      (condition.operator === 'contains' || condition.operator === 'eq')
    ) {
      values.push(condition.value);
    }
  });
  return values;
}

/** An excerpt on one line, without Markdown heading marks. */
function cleanExcerpt(text: string | undefined): string | undefined {
  const line = text
    ?.replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return line || undefined;
}

/** The word under the end of the input, or '' after a space. */
export function getTrailingToken(input: string): string {
  return input.match(/[^\s()]*$/)?.[0] ?? '';
}

function isBareWord(token: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u.test(token);
}


function firstLine(content: string, skip?: string): string | undefined {
  const line = content
    .split(/\r?\n/)
    .map((candidate) => candidate.replace(/^#+\s*/, '').trim())
    .find(
      (candidate) =>
        candidate.length > 0 &&
        candidate !== '---' &&
        (skip === undefined || candidate !== skip.replace(/^#+\s*/, '').trim()),
    );
  return line && line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
