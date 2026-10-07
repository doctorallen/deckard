import type { ParsedFile } from '../../domain/model';
import { getFileName, getFolder } from '../../shared/paths';

/**
 * Where Add Task writes a new task, and how its editor says so.
 *
 * Add Task writes into the note in the active editor when one is open, at
 * its cursor, and into today's daily note otherwise. The editor's Note row
 * names the note and offers the others: this note, today's, another, or a
 * heading in any note. The names, the choices, the order notes are offered
 * in, and where on the cursor's line a task goes are decided here, without
 * VS Code, so a test reads each one.
 */

/** Where a new task goes, as far as naming it goes; `path` is the note's, as the workspace shows it. */
export type TaskTarget =
  /** The note in the active editor, at the cursor. */
  | { kind: 'here'; path: string }
  /** Today's daily note, made from its template when it is missing. */
  | { kind: 'today'; path: string }
  /** Another note, after its last list item or text. */
  | { kind: 'note'; path: string }
  /** Under a heading in any note, above any heading nested in it. */
  | { kind: 'heading'; path: string; heading: string };

/** The four places the Note row offers. */
export type TaskTargetKind = TaskTarget['kind'];

/** The editor's title, the note named plainly: `Add a task to 2026-10-06.md`. */
export function titleTaskTarget(target: TaskTarget): string {
  const name = getFileName(target.path);
  return target.kind === 'heading'
    ? `Add a task under ${target.heading} in ${name}`
    : `Add a task to ${name}`;
}

/** What the Note row says: the note's path, and which note it is when that is not plain. */
export function describeTaskTarget(target: TaskTarget): string {
  switch (target.kind) {
    case 'here':
      return `${target.path} · this note`;
    case 'today':
      return `${target.path} · today’s note`;
    case 'note':
      return target.path;
    case 'heading':
      return `${target.heading} · ${target.path}`;
  }
}

/** One place the Note row offers, as its pick lists it. */
export interface TaskTargetChoice {
  /** The place, named `target` since a pick row's `kind` is its own. */
  target: TaskTargetKind;
  label: string;
  description: string;
}

/** The notes the Note row can name before anything is chosen: the one being edited, if any, and today's. */
export interface TaskTargetPlaces {
  /** The note in the active editor, when there is one. */
  here?: string;
  today: string;
}

/**
 * The places a task can go, the current one said to be: this note when
 * there is one, today's note, another note, and a heading in any note.
 */
export function listTaskTargetChoices(current: TaskTarget, places: TaskTargetPlaces): TaskTargetChoice[] {
  const now = (kind: TaskTargetKind, description: string): string =>
    current.kind === kind ? `${description} · now` : description;
  return [
    ...(places.here === undefined
      ? []
      : [{ target: 'here' as const, label: '$(edit) This note', description: now('here', places.here) }]),
    { target: 'today', label: '$(calendar) Today’s note', description: now('today', places.today) },
    {
      target: 'note',
      label: '$(file) Another note…',
      description: current.kind === 'note' ? `${current.path} · now` : 'The notes changed last first',
    },
    {
      target: 'heading',
      label: '$(list-tree) Under a heading…',
      description: current.kind === 'heading' ? `${current.heading} · now` : 'In any note, the headings used last first',
    },
  ];
}

/** A note Another note… offers: its name, the folder it is in, and its index path. */
export interface NoteChoice {
  filePath: string;
  label: string;
  description: string;
}

/** Every indexed note, the one changed last first, then by path. */
export function listNoteChoices(files: Iterable<Pick<ParsedFile, 'filePath' | 'updatedAt'>>): NoteChoice[] {
  return [...files]
    .sort(
      (left, right) =>
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.filePath.localeCompare(right.filePath),
    )
    .map((file) => ({
      filePath: file.filePath,
      label: getFileName(file.filePath),
      description: getFolder(file.filePath),
    }));
}

/**
 * Where a task added to the note being edited goes: on the cursor's line,
 * which becomes the task, or on a new line below it, as deep as the list
 * item there.
 */
export type HerePlacement = { mode: 'line' } | { mode: 'below'; indent: string };

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/;

/**
 * Where on the cursor's line a new task goes. A blank line takes it, and a
 * line of plain words becomes it, as Add Task always made one; a task
 * stays as it is, and so does a line whose words were selected or which a
 * board column started the task from, so the task goes below them.
 */
export function placeTaskHere(line: string, options: { isTask: boolean; seeded: boolean }): HerePlacement {
  if (line.trim() === '' || (!options.isTask && !options.seeded)) {
    return { mode: 'line' };
  }
  return { mode: 'below', indent: LIST_ITEM.exec(line)?.[1] ?? '' };
}
