import { stripTags } from '../../core/markdown/parser';
import { getPlainTextTerms } from '../../core/query/queryEdit';
import { evaluateQuery } from '../../core/query/queryEvaluator';
import {
  collectQueryTagKeys,
  visitConditions,
} from '../../core/query/queryFormat';
import { parseQuery } from '../../core/query/queryParser';
import { QueryNode, QuerySuggestion } from '../../core/query/queryTypes';
import { EntrySearchResult } from '../../core/storage/searchStore';
import {
  ParsedFile,
  PersistedPreferences,
  Section,
  TagInfo,
  Task,
  WorkspaceIndex,
} from '../../core/types';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { getHeadingPath } from './dashboardState';
import { frecencyScore } from './frecency';

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
}

export type QuickFindTextSearch = (text: string) => EntrySearchResult;

export interface QuickFindOptions {
  now?: number;
  noteLimit?: number;
  taskLimit?: number;
  /** Whole conditions to offer for the word being typed, such as `is:open`. */
  conditions?: readonly QuerySuggestion[];
}

const TAG_LIMIT = 5;
const CONDITION_LIMIT = 4;
const SAVED_VIEW_LIMIT = 3;
const EMPTY_LIST_LIMIT = 8;

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
  options: QuickFindOptions = {},
): QuickFindResults {
  const now = options.now ?? Date.now();
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

  const ranked = rankEntries(index, preferences, parsed.node, searchText, now);
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
}

/**
 * Finds and orders the note entries and tasks a parsed search matches.
 *
 * A search of plain words asks the full-text index, which is fast and ranks
 * by relevance; a search with any other condition is answered by the query
 * evaluator, so it means exactly what it means everywhere else, and its words
 * only order the results.
 */
function rankEntries(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  node: QueryNode,
  searchText: QuickFindTextSearch,
  now: number,
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
    const results = evaluateQuery(index, node);
    sections = results.sections;
    tasks = results.tasks;
    files = results.files;
  }

  const base = plainTerms ? 0 : QUERY_MATCH;
  const noteEntries: RankedEntry[] = [
    ...sections.map((section) => {
      const title = stripTags(section.heading) || getFileName(section.filePath);
      const found = textScores.get(section.id);
      return {
        score:
          base +
          scoreTitle(words, title) +
          (found?.score ?? 0) +
          frecencyBonus(preferences, section.id, now),
        updatedAt: section.updatedAt ?? 0,
        item: createSectionItem(index, section, title, found?.excerpt),
      };
    }),
    ...files.map((file) => {
      const title = getFileName(file.filePath);
      const found = textScores.get(file.filePath);
      return {
        score: base + scoreTitle(words, title) + (found?.score ?? 0),
        updatedAt: file.updatedAt ?? 0,
        item: {
          kind: 'note' as const,
          label: title,
          description: file.filePath,
          detail: cleanExcerpt(found?.excerpt) ?? firstLine(file.content),
          filePath: file.filePath,
          line: 1,
        },
      };
    }),
  ].sort(compareRanked);

  const taskEntries: RankedEntry[] = tasks
    .map((task) => {
      const title = stripTags(task.title) || task.title;
      const found = textScores.get(task.id);
      return {
        // An open task is usually the one being looked for.
        score:
          base +
          scoreTitle(words, title) +
          (found?.score ?? 0) +
          (task.completed ? 0 : 20),
        updatedAt: task.updatedAt ?? 0,
        item: createTaskItem(index, task, title),
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
        Math.log2(1 + tag.count);
      return [{ tag, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.tag.label.localeCompare(right.tag.label),
    )
    .slice(0, TAG_LIMIT)
    .map(({ tag }) => createTagItem(tag, `${prefix}${tag.key} `));
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
 * What Quick Find offers before anything is typed: recent searches, the tags
 * most likely to be wanted, saved views, and recently opened notes.
 */
function buildEmptyResults(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  now: number,
): QuickFindResults {
  const recent = (preferences.recentQueries ?? [])
    .slice(0, EMPTY_LIST_LIMIT)
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
    .map(({ tag }) => createTagItem(tag, `${tag.key} `));
  const savedViews = preferences.savedFilters.map((filter) =>
    createSavedViewItem(index, filter),
  );
  const notes = Object.entries(preferences.sectionAccessTimes ?? {})
    .sort((left, right) => right[1] - left[1])
    .flatMap(([sectionId]) => {
      const section = index.sections.get(sectionId);
      return section
        ? [
            createSectionItem(
              index,
              section,
              stripTags(section.heading) || getFileName(section.filePath),
            ),
          ]
        : [];
    })
    .slice(0, EMPTY_LIST_LIMIT);
  return {
    tags,
    conditions: [],
    recent,
    savedViews,
    notes,
    tasks: [],
    totals: { notes: 0, tasks: 0 },
  };
}

function createTagItem(tag: TagInfo, completion: string): QuickFindItem {
  return {
    kind: 'tag',
    label: tag.label,
    description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
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
    completed: task.completed,
  };
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

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
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
