import { isRecord } from '../../shared/guards';
import { TaskPriority } from '../../domain/model';

/**
 * What an assistant may send to the two write tools, read and checked
 * before anything is written.
 *
 * VS Code checks a call against the schema the manifest declares, but an MCP
 * client, or an extension calling a tool directly, need not, so each field is
 * checked again here. These readers are vscode-free so that the tool table in
 * ./assistantTools, which both the language-model tools and the MCP server
 * dispatch through, can use them; the writes themselves are in
 * ui/commands/assistantWrites.
 */

/** The add-task tool's name, as the manifest declares it. */
export const ADD_TASK_TOOL_NAME = 'deckard_add_task';
/** The change-task tool's name, as the manifest declares it. */
export const CHANGE_TASK_TOOL_NAME = 'deckard_change_task';

/** An add-task call, read. */
export interface AddTaskInput {
  /** The task's words; metadata such as 📅 2026-09-20 or ⏫ may be written in them. */
  text: string;
  /** A workspace-relative note to add it to; today's daily note when absent. */
  note?: string;
}

/** `null` clears a field; absent leaves it. */
export interface ChangeTaskInput {
  note: string;
  line: number;
  title?: string;
  complete?: boolean;
  /** A status by its name, or its character in brackets, as `[/]`. */
  status?: string;
  due?: string | null;
  priority?: TaskPriority | null;
  assignee?: string | null;
}

/** The priorities a call may set, as the manifest's schema lists them. */
const PRIORITIES: readonly TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];
/** A due date as a call must send it, YYYY-MM-DD. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The most characters a task's words may run to, so a call cannot write a page into one line. */
const MAX_TEXT = 500;

/**
 * Reads an add-task call, with its words' whitespace collapsed, or nothing
 * when it has no words or more than 500 characters of them.
 */
export function readAddTaskInput(value: unknown): AddTaskInput | undefined {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return undefined;
  }
  const text = value.text.trim().replace(/\s+/g, ' ');
  if (!text || text.length > MAX_TEXT) {
    return undefined;
  }
  const note = typeof value.note === 'string' ? value.note.trim() : '';
  return note ? { text, note } : { text };
}

/**
 * Reads a change-task call, or nothing when it names no note and line, when
 * any field it sends is malformed, or when it asks for no change at all.
 */
export function readChangeTaskInput(value: unknown): ChangeTaskInput | undefined {
  if (
    !isRecord(value) ||
    typeof value.note !== 'string' ||
    !value.note.trim() ||
    typeof value.line !== 'number' ||
    !Number.isInteger(value.line) ||
    value.line < 1
  ) {
    return undefined;
  }
  const input: ChangeTaskInput = { note: value.note.trim(), line: value.line };
  for (const field of CHANGE_FIELDS) {
    if (value[field] !== undefined && !readChangeField(input, field, value[field])) {
      return undefined;
    }
  }
  return CHANGE_FIELDS.some((field) => input[field] !== undefined) ? input : undefined;
}

/** The changes a call may ask for, in the order they are read. */
const CHANGE_FIELDS = ['title', 'complete', 'status', 'due', 'priority', 'assignee'] as const;

/** A field a change-task call may change. */
type ChangeField = (typeof CHANGE_FIELDS)[number];

/** What a field reader answers for a value the call may not send. */
const INVALID = Symbol('invalid');

/**
 * How each change is read from a value the call sent: the value to keep, or
 * INVALID. `null` clears a date, priority, or assignee, so it is kept.
 */
const CHANGE_FIELD_READERS: {
  readonly [K in ChangeField]: (value: unknown) => ChangeTaskInput[K] | typeof INVALID;
} = {
  title: (value) =>
    typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT
      ? INVALID
      : value.trim().replace(/\s+/g, ' '),
  complete: (value) => (typeof value === 'boolean' ? value : INVALID),
  status: (value) => (typeof value === 'string' && value.trim() && value.length <= 80 ? value.trim() : INVALID),
  due: (value) => {
    if (value === null) {
      return null;
    }
    return typeof value === 'string' && ISO_DAY.test(value) ? value : INVALID;
  },
  priority: (value) => {
    if (value === null) {
      return null;
    }
    return PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : INVALID;
  },
  assignee: (value) => {
    if (value === null) {
      return null;
    }
    return typeof value === 'string' && /^\S{1,80}$/.test(value) ? value : INVALID;
  },
};

/** Reads one change the call sent into `input`; false when the value is one it may not send. */
function readChangeField<K extends ChangeField>(
  input: ChangeTaskInput,
  field: K,
  value: unknown,
): boolean {
  const read = CHANGE_FIELD_READERS[field](value);
  if (read === INVALID) {
    return false;
  }
  input[field] = read;
  return true;
}
