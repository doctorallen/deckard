import { TaskPriority } from '../model';
import { isTaskLineOf, matchTaskLine, STATUS_MARKS, TaskLineShape } from './lineShapes';
import { DEFAULT_TASK_STATUSES, statusForSymbol, type TaskStatusDefinition } from '../tasks/taskStatuses';
import {
  BLOCK_ID_PATTERN,
  formatTaskMetadata,
  parseTaskMetadata,
  TaskDateField,
  TaskMetadataFormat,
} from './taskFields';

/**
 * A task line taken apart, so each part can be edited on its own and the
 * line written again from all of them.
 *
 * Deckard's other task edits change one field where it is written and leave
 * the rest of the line untouched. An editor changes several at once, so it
 * reads the whole line into a draft and writes the whole line back — which
 * means the draft has to carry everything the line held, including the parts
 * Deckard does not offer to edit.
 */
export interface TaskDraft {
  /** The whitespace and list marker before the checkbox, and the box, as written. */
  prefix: string;
  /** The character in the box, which formatTaskDraft writes there. */
  symbol: string;
  /** Whether that character's status is done. */
  completed: boolean;
  /** The words of the task, with its metadata taken out. */
  description: string;
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  priority?: TaskPriority;
  /** The 🔁 rule as written, such as "every week". */
  recurrence?: string;
  /** 🆔 the name other tasks depend on. */
  id?: string;
  /** ⛔ the names of the tasks this one waits for. */
  dependsOn: string[];
  /** 👤 the person the task is for, as the tag is written: `@dana`. */
  assignee?: string;
  /**
   * Parts of the line Deckard does not edit but must not lose: an
   * on-completion marker, and a trailing `^block-id`.
   */
  extras: string[];
  blockId?: string;
  /** The format its metadata is written in. */
  format: TaskMetadataFormat;
}

/**
 * The checkbox line a draft is read from and written back to. The one blank
 * after the box is read as part of it, so the description starts after it.
 */
const TASK_LINE: TaskLineShape = { indent: 'whitespace', marks: STATUS_MARKS, after: 'optional-blank' };
/** An on-completion marker, in either format, which is kept as written. */
const ON_COMPLETION =
  /🏁️?[ \t]*(?:keep|delete)|\[[ \t]*onCompletion[ \t]*::[^\]]*\]/giu;

/** The order Tasks writes metadata in, and the one a draft writes back. */
const DATE_ORDER: readonly TaskDateField[] = [
  'created',
  'start',
  'scheduled',
  'due',
  'cancelled',
  'done',
];

/** Whether a line is a checklist item Deckard can edit as a task. */
export function isTaskLine(line: string): boolean {
  return isTaskLineOf(line, TASK_LINE);
}

/**
 * Reads a task line into a draft, or makes an empty one from a line that is
 * not a task yet — keeping whatever was written on it as the description.
 */
export function parseTaskDraft(
  line: string,
  fallbackFormat: TaskMetadataFormat = 'emoji',
  statuses: readonly TaskStatusDefinition[] = DEFAULT_TASK_STATUSES,
): TaskDraft {
  const match = matchTaskLine(line, TASK_LINE);
  const symbol = match ? match.mark : ' ';
  const prefix = match ? `${match.head} ` : `${/^\s*/.exec(line)?.[0] ?? ''}- [ ] `;
  const body = match ? match.body : line.trim();

  const extras = body.match(ON_COMPLETION) ?? [];
  const blockId = BLOCK_ID_PATTERN.exec(body)?.[1];
  const { metadata, title, format } = parseTaskMetadata(body);
  return {
    prefix,
    symbol,
    completed: statusForSymbol(statuses, symbol).type === 'done',
    description: title,
    ...metadata,
    dependsOn: metadata.dependsOn,
    extras: extras.map((extra) => extra.trim()),
    ...(blockId ? { blockId } : {}),
    format: format ?? fallbackFormat,
  };
}

/** The column of a draft's box character, in its prefix and in the line it is written as. */
export function draftCheckboxColumn(draft: Pick<TaskDraft, 'prefix'>): number {
  return draft.prefix.lastIndexOf('[') + 1;
}

/**
 * Writes a draft back as one task line: the description, then its metadata
 * in the order Tasks writes it, then the parts Deckard kept but does not
 * edit, and last of all the block id, which has to end the line.
 */
export function formatTaskDraft(draft: TaskDraft): string {
  const write = (
    field: Parameters<typeof formatTaskMetadata>[0],
    value: string | undefined,
  ): string[] =>
    value === undefined || value === '' ? [] : [formatTaskMetadata(field, value, draft.format)];

  const tokens = [
    ...write('priority', draft.priority),
    ...write('repeat', draft.recurrence),
    ...DATE_ORDER.flatMap((field) => write(field, draft[field])),
    ...write('id', draft.id),
    ...(draft.dependsOn.length > 0
      ? [formatTaskMetadata('dependsOn', draft.dependsOn.join(', '), draft.format)]
      : []),
    // Who it is for reads last, where a reader looks for it.
    ...write('assignee', draft.assignee),
    ...draft.extras,
  ];
  const column = draftCheckboxColumn(draft);
  const checkbox = `${draft.prefix.slice(0, column)}${draft.symbol}${draft.prefix.slice(column + 1)}`;
  const body = [draft.description.trim(), ...tokens].filter(Boolean).join(' ');
  return `${checkbox}${body}${draft.blockId ? ` ^${draft.blockId}` : ''}`.replace(
    /[ \t]+$/,
    '',
  );
}

/** What a draft's field reads as in the editor, or nothing when it is unset. */
export function describeTaskDraftField(
  draft: TaskDraft,
  field: keyof TaskDraft,
): string {
  const value = draft[field];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return typeof value === 'string' ? value : '';
}
