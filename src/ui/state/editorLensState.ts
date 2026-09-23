import {
  findDailyNoteDate,
  findFencedLines,
} from '../../core/markdown/parser';
import { ParsedFile, Task, WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  noteTitle,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../core/workspace/backlinks';
import { findAdjacentDailyNote, listDailyNotes } from '../commands/dailyNote';
import { planRollover } from '../commands/rollover';
import { findEmbedLines, resolveEmbed } from '../preview/noteEmbeds';

/**
 * What the editor's action lenses decide, apart from VS Code. Each function
 * returns only what is worth a lens, so an empty result means no lens at all.
 */

export interface TaskDependencies {
  /** Zero-based line of the task. */
  line: number;
  /** Open tasks whose `🆔` this task's `⛔` names. */
  waitingOn: Task[];
  /** Names in this task's `⛔` that no task in the workspace carries. */
  missingIds: string[];
  /** Open tasks whose `⛔` names this task's `🆔`, while it is open itself. */
  blocking: Task[];
}

/**
 * The tasks in a note that wait on, or hold up, another open task.
 *
 * `file` is usually parsed from the editor, so its own tasks follow unsaved
 * edits; every other note's tasks come from the index. A done task is neither
 * waited on nor blocking, which is how `is:blocked` and `is:blocking` read
 * the same markers.
 */
export function findTaskDependencies(
  file: ParsedFile,
  index: WorkspaceIndex,
): TaskDependencies[] {
  const own = file.tasks.filter(
    (task) => task.dependencyId || (task.dependsOn?.length ?? 0) > 0,
  );
  if (own.length === 0) {
    return [];
  }

  const tasks = [
    ...[...index.tasks.values()].filter(
      (task) => task.filePath !== file.filePath,
    ),
    ...file.tasks,
  ];
  const carriers = new Map<string, Task[]>();
  const waiters = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.dependencyId) {
      append(carriers, task.dependencyId, task);
    }
    if (!task.completed) {
      new Set(task.dependsOn).forEach((id) => append(waiters, id, task));
    }
  }

  return own.flatMap((task) => {
    const ids = [...new Set(task.dependsOn ?? [])];
    const waitingOn = task.completed
      ? []
      : ids.flatMap((id) =>
          (carriers.get(id) ?? []).filter(
            (carrier) => carrier !== task && !carrier.completed,
          ),
        );
    // A done task no longer waits, so a name it gives that went nowhere no
    // longer matters either.
    const missingIds = task.completed
      ? []
      : ids.filter((id) => !carriers.has(id));
    const blocking =
      task.completed || !task.dependencyId
        ? []
        : (waiters.get(task.dependencyId) ?? []).filter(
            (waiter) => waiter !== task,
          );
    return waitingOn.length > 0 || missingIds.length > 0 || blocking.length > 0
      ? [{ line: task.lineNumber - 1, waitingOn, missingIds, blocking }]
      : [];
  });
}

export interface DailyNoteActions {
  /** The nearest daily notes before and after this one, by date. */
  previous?: string;
  next?: string;
  /**
   * Unfinished tasks in earlier daily notes that a rollover would carry into
   * this one: only on today's note, and without the lines already in it.
   */
  carryIn: Task[];
}

/**
 * What a daily note offers: its neighbors, and on today's note, the tasks
 * still open in earlier ones. Undefined for a note that is not a daily note,
 * or a daily note with nothing to offer.
 *
 * A rollover leaves behind a task whose line is already in today's note, so
 * those are not counted; in copy mode they stay in the note they came from,
 * and would otherwise keep offering to carry in what is already there.
 */
export function findDailyNoteActions(
  file: ParsedFile,
  index: WorkspaceIndex,
  today: string,
  lookbackDays = 0,
): DailyNoteActions | undefined {
  const date = findDailyNoteDate(
    file.filePath,
    file.sections
      .filter((section) => section.headingLevel === 1)
      .map((section) => section.heading),
  );
  if (!date) {
    return undefined;
  }
  const notes = listDailyNotes(index).filter(
    (note) => note.filePath !== file.filePath,
  );
  const previous = findAdjacentDailyNote(notes, date, 'previous')?.date;
  const next = findAdjacentDailyNote(notes, date, 'next')?.date;
  const written = new Set(
    file.content.split(/\r?\n/).map((line) => line.trim()),
  );
  const carryIn =
    date === today
      ? (planRollover(index, today, lookbackDays)?.tasks ?? []).filter(
          (task) =>
            task.filePath !== file.filePath &&
            !written.has(task.sourceLineText.trim()),
        )
      : [];
  if (!previous && !next && carryIn.length === 0) {
    return undefined;
  }
  return {
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
    carryIn,
  };
}

export interface EmbedProblem {
  /** Zero-based line of the embed. */
  line: number;
  /** What the preview draws in its place, such as a heading gone missing. */
  reason: string;
  /** The note the embed names, when it is another note that exists. */
  filePath?: string;
}

/**
 * The embeds in a note that the preview would draw as a message rather than
 * a note: a heading or a `^marker` the named note does not have. An embed
 * whose note name opens no note is left out, since the link inside it is
 * already a link problem, counted on the note's first line and marked where
 * it is written.
 */
export function findEmbedProblems(
  file: ParsedFile,
  index: WorkspaceIndex,
): EmbedProblem[] {
  const embeds = findEmbedLines(file.content);
  if (embeds.length === 0) {
    return [];
  }
  const titles = createNoteTitleMap(index);
  return embeds.flatMap(({ line, target }) => {
    const { note } = parseWikiTarget(target);
    const filePath = note
      ? resolveWikiTarget(titles, note, file.filePath)
      : undefined;
    if (note && !filePath) {
      return [];
    }
    const embed = resolveEmbed(target, file.content, index);
    if (embed.kind !== 'missing') {
      return [];
    }
    return [
      {
        line,
        reason: embed.reason.replace(/\.$/, ''),
        ...(filePath && filePath !== file.filePath ? { filePath } : {}),
      },
    ];
  });
}

export interface UnlinkedMention {
  filePath: string;
  /** Zero-based line, and the columns of the name as written. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The name as written, which the link keeps. */
  text: string;
}

/** A name shorter than this is too likely to be an ordinary word. */
const MIN_MENTION_LENGTH = 3;
/**
 * What a mention is never found inside: a `[[link]]`, inline code, a Markdown
 * link or its target, a bare URL, and a `#tag` or `@person`.
 */
const NOT_PROSE =
  /\[\[[^\]]*\]\]|`[^`]*`|!?\[[^\]]*\]\([^)]*\)|<?https?:\/\/[^\s>]+>?|[#@][\p{L}\p{N}_/-]+/gu;

const mentionCache = new WeakMap<WorkspaceIndex, Map<string, UnlinkedMention[]>>();

/**
 * The places other notes write a note's title or one of its aliases as plain
 * prose, not linked: the names a `[[link]]` could be made of.
 *
 * A mention is whole words, matched without regard to case, outside front
 * matter, headings, code fences, and anything `NOT_PROSE` names. Headings are
 * left alone because a heading's text is what links into it name. A name
 * shorter than three characters is not looked for, nor a name another note
 * also goes by, since a link made of it would not open this note. Where two
 * names overlap, such as a title and a longer alias that contains it, the
 * longer is the mention.
 *
 * The workspace is read once per index for each note, so asking again after
 * every keystroke costs a lookup.
 */
export function findUnlinkedMentions(
  file: ParsedFile,
  index: WorkspaceIndex,
): UnlinkedMention[] {
  const titles = createNoteTitleMap(index);
  const names = [noteTitle(file.filePath), ...(file.aliases ?? [])]
    .map((name) => name.trim())
    .filter((name, position, all) => {
      const key = name.toLocaleLowerCase();
      const owners = titles.get(key) ?? [];
      return (
        name.length >= MIN_MENTION_LENGTH &&
        owners.every((owner) => owner === file.filePath) &&
        all.findIndex((other) => other.toLocaleLowerCase() === key) === position
      );
    })
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) {
    return [];
  }

  const key = [file.filePath, ...names].join('\u0000');
  let cached = mentionCache.get(index);
  if (!cached) {
    cached = new Map();
    mentionCache.set(index, cached);
  }
  const known = cached.get(key);
  if (known) {
    return known;
  }

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
    'giu',
  );
  const mentions: UnlinkedMention[] = [];
  index.files.forEach((other, filePath) => {
    if (filePath === file.filePath) {
      return;
    }
    const lines = other.content.split(/\r?\n/);
    const fenced = findFencedLines(lines);
    const frontmatterEnd = findFrontmatterEnd(lines);
    lines.forEach((text, line) => {
      if (line <= frontmatterEnd || fenced.has(line) || /^ {0,3}#{1,6}\s/.test(text)) {
        return;
      }
      // Blank out what is not prose, keeping every column where it was.
      const prose = text.replace(NOT_PROSE, (match) => ' '.repeat(match.length));
      for (const match of prose.matchAll(pattern)) {
        const startColumn = match.index ?? 0;
        mentions.push({
          filePath,
          line,
          startColumn,
          endColumn: startColumn + match[0].length,
          text: text.slice(startColumn, startColumn + match[0].length),
        });
      }
    });
  });
  mentions.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.startColumn - right.startColumn,
  );
  cached.set(key, mentions);
  return mentions;
}

/** The last line of a note's front matter, or -1 when it has none. */
function findFrontmatterEnd(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') {
    return -1;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end < 0 ? -1 : end;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}
