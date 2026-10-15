/**
 * The story so far (docs/implementation/40-story-so-far.md): every line
 * about a tag on one dated timeline, which its page's Story tab draws by
 * month, so months of daily notes read in one scroll.
 *
 * - A line is about the tag when it carries the tag, or sits under a
 *   heading, at any level, or in a note whose front matter does (D17).
 *   Headings, blank lines, front matter, and fenced code, query blocks
 *   among it, are not lines of the story, and neither is the tag's own hub
 *   note, which is its summary.
 * - A line's day is its daily note's, else its note's `created:`, else its
 *   file's. Within a day, lines keep their note's order, and notes go by
 *   path.
 * - The lines indented under a line are read with it, so a task's steps
 *   and a question's answer are one row.
 *
 * Each line is of a kind, read from a table, so a kind a later plan adds
 * is a row of it and a filter of {@link STORY_FILTERS}. A question
 * (docs/implementation/38-questions.md) is one: its `[?]` line is no task,
 * and its `Answer:` line, indented under it, reads with it.
 */
import { formatIsoDate, parseIsoDate } from '../../domain/markdown/calendar';
import { formatMonthAndYear, formatShortDay } from '../../domain/markdown/dates';
import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { tokenizeInline } from '../../domain/markdown/inline';
import { findFencedLines, readHeading } from '../../domain/markdown/lineShapes';
import { findListParents, lineIndent } from '../../domain/markdown/listNesting';
import { extractTags, findFileDailyNoteDate, stripTags } from '../../domain/markdown/parser';
import { noteTitle } from '../../domain/index/backlinks';
import type { ParsedFile, Question, TagReference, Task, WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import type { QueryResults } from '../../domain/query/queryEvaluator';
import { getTypeIndex } from '../../domain/types/typeIndex';
import type { TypeRegistry } from '../../domain/types/typeRegistry';
import type { SearchPageStory, SearchPageStoryRow, StoryFilter, StoryKind } from '../protocol/searchPage';
import { drawTaskStatus } from './drawnStatus';

/** How many rows the tab draws at first, and how many more each Show more adds. */
export const STORY_PAGE_SIZE = 100;

/** One line of a tag's story, as its note holds it, before it is drawn. */
export interface StoryLine {
  filePath: string;
  /** The one-based line it is written on. */
  line: number;
  /** Its day, `YYYY-MM-DD`; empty for a note with no date at all. */
  date: string;
  kind: StoryKind;
  /** Its words: a task's title, or the line without its list mark and box. */
  text: string;
  /** The heading it is under, its tags aside, or its note's title. */
  where: string;
  /** The task it is, when it is one. */
  task?: Task;
  /** The lines indented under it, each with the mark its box gives it, when it has one. */
  children: Array<{ text: string; mark?: string }>;
}

/** How a kind's row is marked, and how its mark is said. */
interface StoryKindMark {
  /** What the row draws: `D`, `?`, `·`; a task draws its box instead. */
  mark: string;
  /** What the mark means, for a screen reader and the mark's tip. */
  label: string;
}

/** Each kind's mark. A task's box is its mark, `✓` or `☐`, where a child line or the copy needs one in words. */
export const STORY_KINDS: Readonly<Record<StoryKind, StoryKindMark>> = {
  decision: { mark: 'D', label: 'Decision' },
  done: { mark: '✓', label: 'Done' },
  open: { mark: '☐', label: 'Open task' },
  question: { mark: '?', label: 'Question' },
  note: { mark: '·', label: 'Note' },
};

/** One filter of the tab: what its chip says, and the kinds it keeps; All keeps every kind. */
interface StoryFilterRule {
  id: StoryFilter;
  label: string;
  kinds?: readonly StoryKind[];
  /**
   * Drawn only while the story holds a row of its kinds, as a story with
   * no question has no Questions chip.
   */
  whileHeld?: true;
}

/** The tab's filters, in their chips' order. */
export const STORY_FILTERS: readonly StoryFilterRule[] = [
  { id: 'all', label: 'All' },
  { id: 'decisions', label: 'Decisions', kinds: ['decision'] },
  { id: 'done', label: 'Done', kinds: ['done'] },
  { id: 'questions', label: 'Questions', kinds: ['question'], whileHeld: true },
];

/** How the tab is shown: its filter, its order, and how many rows it draws. */
export interface StoryView {
  filter: StoryFilter;
  oldestFirst: boolean;
  limit: number;
}

/** The tab as it first opens: every row, newest first (D18), the first page of them. */
export const DEFAULT_STORY_VIEW: StoryView = { filter: 'all', oldestFirst: false, limit: STORY_PAGE_SIZE };

/** A line's list mark and its box, which the row draws in its own way. */
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])[ \t]+(?:\[[^\]]\][ \t]+)?/;

/** A thematic break, which is no line of the story. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * Every line about a tag, oldest first, of the entries, tasks, and notes
 * a search found for it: its page's search, which Refine may narrow. The
 * tag's hub notes are left out.
 */
export function collectStory(
  index: WorkspaceIndex,
  tagKey: string,
  results: QueryResults,
  { hubPaths, context }: { hubPaths: readonly string[]; context: QueryContext },
): StoryLine[] {
  const hubs = new Set(hubPaths);
  const found = foundLines(results);
  const registry = getTypeIndex(index).registry;
  const lines: StoryLine[] = [];
  [...found.keys()].sort(compareText).forEach((filePath) => {
    const file = index.files.get(filePath);
    if (file && !hubs.has(filePath)) {
      lines.push(...readFileStory(file, found.get(filePath) as FoundLines, { tagKey, registry, context }));
    }
  });
  // A sort that keeps the order it was given among equals: a day's notes by path, each note's lines in order.
  return lines.sort((left, right) => compareText(left.date, right.date));
}

/** Which lines of a note a search found: all of them, or those of its entries and tasks. */
type FoundLines = 'all' | Set<number>;

/** The lines each note's found entries, tasks, questions, and front-matter entries hold, by note. */
function foundLines(results: QueryResults): Map<string, FoundLines> {
  const found = new Map<string, FoundLines>();
  const add = (filePath: string, from: number, to: number): void => {
    const lines = found.get(filePath) ?? new Set<number>();
    if (lines === 'all') {
      return;
    }
    for (let line = from; line <= to; line += 1) {
      lines.add(line);
    }
    found.set(filePath, lines);
  };
  results.files.forEach((file) => found.set(file.filePath, 'all'));
  results.sections.forEach((section) => add(section.filePath, section.startLine, section.endLine));
  results.tasks.forEach((task) => add(task.filePath, task.lineNumber, task.lineNumber));
  // A question line starts no entry, as a task line does not, so one that
  // carries the tag under a heading that does not is found on its own.
  results.questions.forEach((question) => add(question.filePath, question.lineNumber, question.lineNumber));
  return found;
}

/** A heading above a line, as the story reads it: its level, its words, and what its tags make of the lines under it. */
interface OpenHeading {
  level: number;
  text: string;
  carriesTag: boolean;
  decision: boolean;
}

/** What a note's lines are read against. */
interface StoryReading {
  tagKey: string;
  registry: TypeRegistry;
  context: QueryContext;
}

/** The lines of one note about the tag, in order, each with the lines indented under it. */
function readFileStory(file: ParsedFile, found: FoundLines, reading: StoryReading): StoryLine[] {
  const lines = file.content.split(/\r?\n/);
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const fenced = findFencedLines(lines);
  const listParents = findListParents(lines, fenced);
  const tasks = new Map(file.tasks.map((task) => [task.lineNumber, task]));
  const questions = new Map((file.questions ?? []).map((question) => [question.lineNumber, question]));
  const aliases = reading.context.entityNamespaceAliases;
  const carries = (tags: readonly TagReference[]): boolean => tags.some((tag) => sameTag(tag.key, reading.tagKey));
  const noteCarries = carries(file.frontmatterTags);
  const noteDecision = isDecisionNote(file, reading.registry);
  const date = storyDate(file);
  const headings: OpenHeading[] = [];
  const story: StoryLine[] = [];
  // The row each line was read into, by its 0-based line, so a line indented under it joins it.
  const rowOf = new Map<number, StoryLine>();
  let lastRead: number | undefined;
  const skipped = (text: string, at: number): boolean => at <= frontmatterEnd || fenced.has(at) || !text.trim() || THEMATIC_BREAK.test(text);
  lines.forEach((text, at) => {
    if (skipped(text, at)) {
      return;
    }
    const heading = readHeading(text);
    if (heading) {
      openHeading(headings, heading, extractTags(heading.text, aliases), { carries, registry: reading.registry });
      lastRead = undefined;
      return;
    }
    const parentRow = findParentRow(text, at, { listParents, rowOf, lastRead });
    lastRead = at;
    if (parentRow) {
      parentRow.children.push(readChild(text, tasks.get(at + 1), questions.get(at + 1)));
      rowOf.set(at, parentRow);
      return;
    }
    const inStory = noteCarries || headings.some((open) => open.carriesTag) || carries(extractTags(text, aliases));
    if (!inStory || (found !== 'all' && !found.has(at + 1))) {
      return;
    }
    const row = readRow(text, {
      filePath: file.filePath,
      line: at + 1,
      date,
      task: tasks.get(at + 1),
      question: questions.get(at + 1),
      decision: noteDecision || headings.some((open) => open.decision),
      where: nearestHeading(headings) || noteTitle(file.filePath),
    });
    story.push(row);
    rowOf.set(at, row);
  });
  return story;
}

/** A heading met: it closes those at its level and below, and is open over the lines after it. */
function openHeading(
  headings: OpenHeading[],
  heading: { level: number; text: string },
  tags: readonly TagReference[],
  { carries, registry }: { carries: (tags: readonly TagReference[]) => boolean; registry: TypeRegistry },
): void {
  while (headings.length && headings[headings.length - 1].level >= heading.level) {
    headings.pop();
  }
  headings.push({ level: heading.level, text: heading.text, carriesTag: carries(tags), decision: tags.some((tag) => isDecisionTag(tag.key, registry)) });
}

/**
 * The row a line is indented under, when there is one: the row of the
 * list item it is written under, or, for an indented line that is no list
 * item, the row of the line before it.
 */
function findParentRow(
  text: string,
  at: number,
  { listParents, rowOf, lastRead }: { listParents: ReadonlyMap<number, number | undefined>; rowOf: ReadonlyMap<number, StoryLine>; lastRead: number | undefined },
): StoryLine | undefined {
  if (listParents.has(at)) {
    const parent = listParents.get(at);
    return parent === undefined ? undefined : rowOf.get(parent);
  }
  return lineIndent(text) > 0 && lastRead !== undefined ? rowOf.get(lastRead) : undefined;
}

/** A line of the story: its kind, its words, and where it is. */
function readRow(
  text: string,
  { filePath, line, date, task, question, decision, where }: {
    filePath: string;
    line: number;
    date: string;
    task: Task | undefined;
    question: Question | undefined;
    decision: boolean;
    where: string;
  },
): StoryLine {
  return {
    filePath,
    line,
    date,
    kind: readKind(task, question, decision),
    text: (task ?? question)?.title.trim() ?? lineWords(text),
    where,
    ...(task ? { task } : {}),
    children: [],
  };
}

/**
 * A line's kind. A task is done or open, by its box; a cancelled one is
 * neither, and reads as any other line. A question's `[?]` line is a
 * question, open or answered. Any other line is a decision under a
 * decision's heading or in a decision's note.
 */
function readKind(task: Task | undefined, question: Question | undefined, decision: boolean): StoryKind {
  if (task) {
    if (task.completed) {
      return 'done';
    }
    return task.status.type === 'cancelled' ? 'note' : 'open';
  }
  if (question) {
    return 'question';
  }
  return decision ? 'decision' : 'note';
}

/** A line indented under a row: its words, and its box's mark when it is a task or a question. */
function readChild(text: string, task: Task | undefined, question: Question | undefined): StoryLine['children'][number] {
  if (task) {
    return { text: task.title.trim(), mark: task.completed ? STORY_KINDS.done.mark : STORY_KINDS.open.mark };
  }
  return question ? { text: question.title.trim(), mark: STORY_KINDS.question.mark } : { text: lineWords(text) };
}

/** A line's words, its list mark and box aside. */
function lineWords(text: string): string {
  return text.replace(LIST_MARK, '').trim();
}

/** The nearest heading above a line, its tags aside, or nothing when it has no words but tags. */
function nearestHeading(headings: readonly OpenHeading[]): string {
  return headings.length ? stripTags(headings[headings.length - 1].text).trim() : '';
}

/**
 * Whether two tag keys are one tag: the same, case aside, with a person
 * the same whether written `@sam` or `#person/sam`.
 */
function sameTag(left: string, right: string): boolean {
  const key = (tag: string): string => tag.toLowerCase().replace(/^#person\//, '@');
  return key(left) === key(right);
}

/** Whether a type is the one decisions are: its key or its name is Decision. */
function isDecisionType(type: { key: string; name: string } | undefined): boolean {
  return type !== undefined && (type.key.toLowerCase() === 'decision' || type.name.toLowerCase() === 'decision');
}

/** Whether a note is a decision: its `type:` names the Decision type, or is `decision` where no type is defined. */
function isDecisionNote(file: ParsedFile, registry: TypeRegistry): boolean {
  if (!file.typeKey) {
    return false;
  }
  const type = registry.get(file.typeKey);
  return type ? isDecisionType(type) : file.typeKey.trim().toLowerCase() === 'decision';
}

/** Whether a tag is a row of the Decision type, which makes the lines under its heading decisions. */
function isDecisionTag(tagKey: string, registry: TypeRegistry): boolean {
  return isDecisionType(registry.forTag(tagKey));
}

/**
 * A note's day: its daily note's, else the day the parser gives it, which
 * is its `created:` however it is written (with a time, or quoted) before
 * its file's; else its file's own; empty when it has none.
 */
function storyDate(file: ParsedFile): string {
  const daily = findFileDailyNoteDate(file);
  if (daily) {
    return daily;
  }
  const at = file.createdAt ?? file.fileTimes?.createdAt;
  return at === undefined ? '' : formatIsoDate(at);
}

/** Two strings by their characters' codes, in the same order on every machine. */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The story's lines as the tab shows them: those the filter keeps, newest
 * day first unless the reader chose oldest first. Within a day the lines
 * keep their order either way, so a day reads as it was written.
 */
export function viewStory(lines: readonly StoryLine[], view: Pick<StoryView, 'filter' | 'oldestFirst'>): StoryLine[] {
  const rule = STORY_FILTERS.find((candidate) => candidate.id === view.filter);
  const kept = rule?.kinds ? lines.filter((line) => (rule.kinds as readonly StoryKind[]).includes(line.kind)) : [...lines];
  return view.oldestFirst ? kept : kept.sort((left, right) => compareText(right.date, left.date));
}

/** The story as its tab draws it: the filters, and the rows shown under their months. */
export function describeStory(lines: readonly StoryLine[], view: StoryView, context: QueryContext): SearchPageStory {
  const shown = viewStory(lines, view);
  const held = new Set(lines.map((line) => line.kind));
  return {
    count: lines.length,
    filters: STORY_FILTERS
      .filter((rule) => !rule.whileHeld || rule.kinds?.some((kind) => held.has(kind)) || rule.id === view.filter)
      .map((rule) => ({ id: rule.id, label: rule.label, ...(rule.id === view.filter ? { active: true as const } : {}) })),
    ...(view.oldestFirst ? { oldestFirst: true as const } : {}),
    total: shown.length,
    months: groupByMonth(shown.slice(0, Math.max(view.limit, 0))).map((month) => ({
      label: month.label,
      rows: month.lines.map((line) => drawStoryRow(line, context)),
    })),
  };
}

/** Lines under their months, in the order given; a month met again after another starts a new group. */
function groupByMonth(lines: readonly StoryLine[]): Array<{ label: string; lines: StoryLine[] }> {
  const months: Array<{ key: string; label: string; lines: StoryLine[] }> = [];
  lines.forEach((line) => {
    const key = line.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) {
      last.lines.push(line);
      return;
    }
    const at = parseIsoDate(line.date);
    months.push({ key, label: at === undefined ? 'Undated' : formatMonthAndYear(at), lines: [line] });
  });
  return months;
}

/** One row as the tab draws it. */
function drawStoryRow(line: StoryLine, context: QueryContext): SearchPageStoryRow {
  const aliases = context.entityNamespaceAliases;
  const tagsOf = (text: string): TagReference[] => extractTags(text, aliases).map((tag) => ({ key: tag.key, label: tag.label }));
  const status = line.task ? drawTaskStatus(line.task, context.taskPolicy) : undefined;
  return {
    filePath: line.filePath,
    line: line.line,
    day: line.date ? formatShortDay(line.date, context.now, context.dateFormats) : '',
    kind: line.kind,
    tokens: tokenizeInline(line.text),
    tags: tagsOf(line.text),
    where: line.where,
    ...(line.task
      ? { task: { id: line.task.id, completed: line.task.completed, title: line.text, ...(status ? { status } : {}) } }
      : {}),
    ...(line.children.length
      ? { children: line.children.map((child) => ({ tokens: tokenizeInline(child.text), tags: tagsOf(child.text), ...(child.mark ? { mark: child.mark } : {}) })) }
      : {}),
  };
}

/**
 * Copy as Markdown: the rows shown, under their months, each with its day,
 * its words, and where it is, and the lines under it indented.
 *
 * ```markdown
 * ## October 2026
 *
 * - 2026-10-14 · Picked the hosted fields #project/atlas (Decisions)
 * ```
 */
export function formatStoryMarkdown(lines: readonly StoryLine[]): string {
  return groupByMonth(lines)
    .map((month) => [
      `## ${month.label}`,
      '',
      ...month.lines.flatMap((line) => [
        `- ${line.date ? `${line.date} · ` : ''}${line.text}${line.where ? ` (${line.where})` : ''}`,
        ...line.children.map((child) => `  - ${child.mark ? `${child.mark} ` : ''}${child.text}`),
      ]),
    ].join('\n'))
    .join('\n\n');
}

/** The rows a story's tab shows, for Copy as Markdown: the filter's, in its order, up to its limit. */
export function shownStoryLines(lines: readonly StoryLine[], view: StoryView): StoryLine[] {
  return viewStory(lines, view).slice(0, Math.max(view.limit, 0));
}
