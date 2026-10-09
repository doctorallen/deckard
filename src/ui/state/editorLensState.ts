import { findDailyNoteDate, stripTags } from '../../domain/markdown/parser';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import {
  createNoteTitleMap,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../domain/index/backlinks';
import { findAdjacentDailyNote, listDailyNotes } from '../../domain/notes/periodicNotes';
import { planRollover } from '../../domain/notes/rolloverPlan';
import { createSourceParser, findEmbedLines, resolveEmbed } from '../../domain/notes/embeds';
import { collectTagProgress, describeTagProgress } from '../../domain/tasks/tagProgress';
import type { QueryContext } from '../../domain/query/queryContext';
import { ParsedFile, Task, WorkspaceIndex } from '../../domain/model';
import { pluralize } from '../../shared/text';

/**
 * What the editor's action lenses decide, apart from VS Code. Each function
 * returns only what is worth a lens, so an empty result means no lens at all.
 */

/** One task's dependency lens: what it waits on, what it names that nothing carries, and what waits on it. */
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
    if (isOpenTask(task)) {
      new Set(task.dependsOn).forEach((id) => append(waiters, id, task));
    }
  }

  return own.flatMap((task) => {
    const ids = [...new Set(task.dependsOn ?? [])];
    const open = isOpenTask(task);
    const waitingOn = open
      ? ids.flatMap((id) =>
          (carriers.get(id) ?? []).filter(
            (carrier) => carrier !== task && isOpenTask(carrier),
          ),
        )
      : [];
    // A done task no longer waits, so a name it gives that went nowhere no
    // longer matters either.
    const missingIds = open ? ids.filter((id) => !carriers.has(id)) : [];
    const blocking =
      !isOpenTask(task) || !task.dependencyId
        ? []
        : (waiters.get(task.dependencyId) ?? []).filter(
            (waiter) => waiter !== task,
          );
    return waitingOn.length > 0 || missingIds.length > 0 || blocking.length > 0
      ? [{ line: task.lineNumber - 1, waitingOn, missingIds, blocking }]
      : [];
  });
}

/** A daily note's lenses: the notes either side of it, and what a rollover would carry in. */
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

/** A note that may be a daily note, and how far back its tasks are looked for. */
export interface DailyNoteActionsOptions {
  file: ParsedFile;
  index: WorkspaceIndex;
  /** Today, as `YYYY-MM-DD`. */
  today: string;
  /** How many days back open tasks are carried in from; 0, the default, is every day. */
  lookbackDays?: number;
  /** The rollover mode, which decides whether older copies of a task count. */
  mode?: 'move' | 'migrate';
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
export function findDailyNoteActions({
  file,
  index,
  today,
  lookbackDays = 0,
  mode = 'move',
}: DailyNoteActionsOptions): DailyNoteActions | undefined {
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
      ? (planRollover(index, today, lookbackDays, mode)?.tasks ?? []).filter(
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

/** An embed the preview cannot draw, with why. */
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
  // The note itself is read once, for every embed of itself it holds.
  const parseSource = createSourceParser();
  return embeds.flatMap(({ line, target }) => {
    const { note } = parseWikiTarget(target);
    const filePath = note
      ? resolveWikiTarget(titles, note, file.filePath)
      : undefined;
    if (note && !filePath) {
      return [];
    }
    const embed = resolveEmbed(target, file.content, index, parseSource);
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

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** How far along one tag a hub note describes is, for the lens on its first line. */
export interface HubProgress {
  tagKey: string;
  tagLabel: string;
  /** "2/6 done (33%) · 1 overdue · next due in 3 days". */
  text: string;
}

/**
 * How far along each tag a hub note's `describes:` names is, in the order it
 * names them; a tag with no task, and a note that describes nothing, has
 * none. The note's own front matter is read from `file`, usually the editor's
 * text; the tasks are the index's.
 */
export function findHubProgress(
  file: ParsedFile,
  index: WorkspaceIndex,
  context: Pick<QueryContext, 'now' | 'taskPolicy'> & Partial<Pick<QueryContext, 'dateFormats'>>,
): HubProgress[] {
  const describes = file.hub?.describes ?? [];
  if (!describes.length) {
    return [];
  }
  // One pass over the tasks for every tag the note describes.
  const counted = collectTagProgress(index, context.now, new Set(describes.map((tag) => tag.key)), context.taskPolicy);
  return describes.flatMap((tag) => {
    const progress = counted.get(tag.key);
    return progress
      ? [{ tagKey: tag.key, tagLabel: tag.label, text: describeTagProgress(progress, context.now, context.taskPolicy, context.dateFormats) }]
      : [];
  });
}

/** One lens on a hub or row note's first line: its words, and what it opens. */
export interface HubLens {
  /** `Person · Credit Trading | 1/3 done (33%) · …`, `Progress: 2/6 done (33%)`, `Incident · Rates`. */
  title: string;
  /** The tag whose page it opens. */
  tagKey?: string;
  tagLabel?: string;
  /** For a note row with no tag, the type whose rows it searches. */
  typeKey?: string;
  typeName?: string;
}

/**
 * The lenses on a hub or row note's first line: each tag's progress, as
 * {@link findHubProgress} gives it, led by the row's type and first
 * relation when the tag is a typed row ("Person · Credit Trading | 1/3
 * done"); then, for each row the note holds that has no progress, its
 * type and relation alone. No new kind of lens: a row's prefix rides on
 * its progress, and a row with none takes the progress lens's place.
 */
export function describeHubLenses(
  progress: readonly HubProgress[],
  rows: ReadonlyArray<{ id: string; tagKeys: readonly string[]; typeKey: string; label?: string; prefix: string; typeName: string }>,
): HubLens[] {
  const used = new Set<string>();
  const lenses: HubLens[] = progress.map((entry) => {
    const row = rows.find((candidate) => candidate.id === entry.tagKey || candidate.tagKeys.includes(entry.tagKey));
    const several = progress.length > 1;
    const body = several ? `${entry.tagLabel}: ${entry.text}` : entry.text;
    let title = several ? body : `Progress: ${entry.text}`;
    if (row) {
      used.add(row.id);
      title = `${row.prefix} | ${body}`;
    }
    return {
      title,
      tagKey: entry.tagKey,
      tagLabel: entry.tagLabel,
    };
  });
  rows.forEach((row) => {
    if (used.has(row.id)) {
      return;
    }
    lenses.push(
      row.tagKeys.length > 0
        ? { title: row.prefix, tagKey: row.tagKeys.includes(row.id) ? row.id : row.tagKeys[0], tagLabel: row.label ?? row.id }
        : { title: row.prefix, typeKey: row.typeKey, typeName: row.typeName },
    );
  });
  return lenses;
}

/** How far along one task's steps are, for the lens above it. */
export interface StepProgress {
  /** Zero-based line of the task. */
  line: number;
  total: number;
  done: number;
  /** Zero-based line of the first open step, when one is open. */
  nextLine?: number;
  /** The first open step's words, without its tags. */
  next?: string;
}

/**
 * Each task in a note that has steps, with how many are done and which is
 * next, in the order written. `file` is usually parsed from the editor, so
 * the counts follow a box ticked a moment ago.
 */
export function findStepProgress(file: ParsedFile): StepProgress[] {
  const byId = new Map(file.tasks.map((task) => [task.id, task]));
  return file.tasks.flatMap((task) => {
    const steps = task.steps;
    if (!steps || steps.total === 0) {
      return [];
    }
    const next = steps.ids.map((id) => byId.get(id)).find((step) => step && isOpenTask(step));
    return [
      {
        line: task.lineNumber - 1,
        total: steps.total,
        done: steps.done,
        ...(next ? { nextLine: next.lineNumber - 1, next: stripTags(next.title).trim() || next.title } : {}),
      },
    ];
  });
}

/**
 * A bar of how far along something is, drawn in text for a lens, which
 * cannot draw anything else: `███░░░░░░░` for 3 of 10, at `width` cells.
 * A start counts one cell, and only all of it fills the bar, so neither
 * none nor nearly all reads as done.
 */
export function formatProgressBar(done: number, total: number, width = 10): string {
  if (total <= 0) {
    return '';
  }
  const ratio = Math.min(1, Math.max(0, done / total));
  let filled = Math.round(ratio * width);
  if (done > 0 && filled === 0) {
    filled = 1;
  }
  if (done < total && filled === width) {
    filled = width - 1;
  }
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * A fix the problems lens offers: the four lenses it replaced, each now one
 * row of its list.
 */
export type NoteProblemFix = 'showBrokenLinks' | 'createMissingNotes' | 'showMentions' | 'linkMentions' | 'showFieldProblems';

/** Each fix as the problems lens's list names it, in the order it lists them. */
export const NOTE_PROBLEM_FIXES: Readonly<Record<NoteProblemFix, string>> = {
  showBrokenLinks: 'Show broken links',
  createMissingNotes: 'Create missing notes',
  showMentions: 'Show unlinked mentions',
  linkMentions: 'Link mentions',
  showFieldProblems: 'Show field problems',
};

/** What the problems lens counts on a note's first line. */
export interface NoteProblemCounts {
  /** Links that name no note, and links that name a note several share. */
  missing: number;
  ambiguous: number;
  /** The names among the missing links a note could be created for. */
  creatable: number;
  /** Mentions of the note written without a link, and the notes they are in. */
  mentions: number;
  mentionNotes: number;
  /**
   * Typed fields' values that name nothing or do not fit their kind, and
   * the note's other type problems (docs/implementation/30-databases.md).
   */
  unresolved?: number;
  fieldProblems?: number;
}

/** The problems lens: what it says, and what selecting it does. */
export interface NoteProblems {
  /** Such as "2 missing · 4 unlinked". */
  title: string;
  /** Each count in words, and what selecting the lens does. */
  tooltip: string;
  /** The fixes that apply, in the order the list names them. */
  fixes: NoteProblemFix[];
  /**
   * The fix selecting the lens runs, when the note has one kind of problem,
   * broken links, unlinked mentions, or field problems; `pick`, a list of
   * the fixes, when it has more.
   */
  action: NoteProblemFix | 'pick';
}

/**
 * The one lens a note's link problems and unlinked mentions share on its
 * first line, or nothing for a note with neither. With one kind of problem
 * it does what that kind's own lens did: creates the missing notes, or, when
 * every broken link names a note several share, shows them; or links the
 * mentions. With both, it lists each fix.
 */
export function describeNoteProblems(counts: NoteProblemCounts): NoteProblems | undefined {
  const broken = counts.missing + counts.ambiguous;
  const hasLinks = broken > 0;
  const hasMentions = counts.mentions > 0;
  const unresolved = counts.unresolved ?? 0;
  const fieldProblems = counts.fieldProblems ?? 0;
  const hasFields = unresolved + fieldProblems > 0;
  if (!hasLinks && !hasMentions && !hasFields) {
    return undefined;
  }
  const parts: string[] = [];
  const said: string[] = [];
  if (counts.missing > 0) {
    parts.push(`${counts.missing} missing`);
    said.push(`${pluralize(counts.missing, 'link names', 'links name')} no note`);
  }
  if (counts.ambiguous > 0) {
    parts.push(`${counts.ambiguous} ambiguous`);
    said.push(`${pluralize(counts.ambiguous, 'link names', 'links name')} a note several notes share`);
  }
  if (hasMentions) {
    parts.push(`${counts.mentions} unlinked`);
    said.push(`${pluralize(counts.mentionNotes, 'note mentions', 'notes mention')} this one without a link`);
  }
  describeFieldProblems(unresolved, fieldProblems, parts, said);
  const fixes: NoteProblemFix[] = [];
  if (hasLinks) {
    fixes.push('showBrokenLinks');
    if (counts.creatable > 0) {
      fixes.push('createMissingNotes');
    }
  }
  if (hasMentions) {
    fixes.push('showMentions', 'linkMentions');
  }
  if (hasFields) {
    fixes.push('showFieldProblems');
  }
  const action = chooseNoteProblemAction(hasLinks, hasMentions, counts.creatable, hasFields);
  const does: Record<NoteProblems['action'], string> = {
    pick: 'Select to choose a fix',
    showBrokenLinks: 'Select to show them in the references view',
    createMissingNotes: `Select to create ${counts.creatable === 1 ? 'the missing note' : `the ${counts.creatable} missing notes`} in your notes folder`,
    showMentions: 'Select to show the mentions in the references view',
    linkMentions: 'Select to turn each mention into a [[link]] to this note',
    showFieldProblems: 'Select to show them in the references view, where each offers its fixes',
  };
  return {
    title: parts.join(' · '),
    tooltip: `${said.join('; ')}. ${does[action]}`,
    fixes,
    action,
  };
}

/** The problems lens's words for a note's typed fields: what it counts, and what each count says. */
function describeFieldProblems(unresolved: number, other: number, parts: string[], said: string[]): void {
  if (unresolved > 0) {
    parts.push(`${unresolved} unresolved`);
    said.push(`${pluralize(unresolved, 'field value')} Deckard cannot read`);
  }
  if (other === 0) {
    return;
  }
  parts.push(pluralize(other, 'field problem'));
  said.push(`${pluralize(other, 'field needs', 'fields need')} a look`);
}

/**
 * What selecting the problems lens does: a list with more than one kind of
 * problem; with field problems alone, showing them; with mentions alone,
 * linking them; with broken links alone, creating the missing notes, or
 * showing the links when no name can be created.
 */
function chooseNoteProblemAction(
  hasLinks: boolean,
  hasMentions: boolean,
  creatable: number,
  hasFields = false,
): NoteProblems['action'] {
  if ([hasLinks, hasMentions, hasFields].filter(Boolean).length > 1) {
    return 'pick';
  }
  if (hasFields) {
    return 'showFieldProblems';
  }
  if (hasMentions) {
    return 'linkMentions';
  }
  return creatable > 0 ? 'createMissingNotes' : 'showBrokenLinks';
}
