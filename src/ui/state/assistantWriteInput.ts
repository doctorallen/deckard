import { isRecord } from '../../shared/guards';
import { TaskPriority } from '../../core/types';

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
  due?: string | null;
  priority?: TaskPriority | null;
  assignee?: string | null;
}

const PRIORITIES: readonly TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
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
  if (value.title !== undefined) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_TEXT) {return undefined;}
    input.title = value.title.trim().replace(/\s+/g, ' ');
  }
  if (value.complete !== undefined) {
    if (typeof value.complete !== 'boolean') {return undefined;}
    input.complete = value.complete;
  }
  if (value.due !== undefined) {
    if (value.due !== null && (typeof value.due !== 'string' || !ISO_DAY.test(value.due))) {return undefined;}
    input.due = value.due;
  }
  if (value.priority !== undefined) {
    if (value.priority !== null && !PRIORITIES.includes(value.priority as TaskPriority)) {return undefined;}
    input.priority = value.priority as TaskPriority | null;
  }
  if (value.assignee !== undefined) {
    if (value.assignee !== null && (typeof value.assignee !== 'string' || !/^\S{1,80}$/.test(value.assignee))) {return undefined;}
    input.assignee = value.assignee;
  }
  const fields = ['title', 'complete', 'due', 'priority', 'assignee'] as const;
  return fields.some((field) => input[field] !== undefined) ? input : undefined;
}
