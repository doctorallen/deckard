// Task metadata as Deckard reads and writes it, gathered for the code that
// imports it from here. Each concern has its own module, so a change to how
// repeat rules are suggested does not touch how a date is parsed:
//
// - taskFields.ts: the two formats, parsing a line's fields, and writing one
// - taskLineEdits.ts: edits to a task line, completion and its next occurrence
// - recurrence.ts: repeat rules, their next dates, and suggestions
// - dueWording.ts: how a due date reads beside today
export { addDays, formatIsoDate, parseIsoDate, startOfDay } from './calendar';
export {
  BLOCK_ID_PATTERN,
  findTaskMetadataSpans,
  formatTaskMetadata,
  parseTaskMetadata,
  TASK_PRIORITY_RANKS,
} from './taskFields';
export type {
  TaskDateField,
  TaskMetadata,
  TaskMetadataField,
  TaskMetadataFormat,
  TaskMetadataSpan,
  TaskMetadataSpanField,
} from './taskFields';
export {
  appendToTaskText,
  createNextOccurrence,
  markMigrated,
  MIGRATED_TASK_LINE,
  setTaskAssignee,
  setTaskDate,
  setTaskLineCompletion,
  setTaskPriority,
  writeCompletion,
} from './taskLineEdits';
export type { CompletionWrite } from './taskLineEdits';
export {
  parseRecurrence,
  PROJECTED_REPEATS,
  projectRepeats,
  recurrenceReference,
  suggestRecurrence,
} from './recurrence';
export type { RecurrenceRule } from './recurrence';
export { describeDueDate } from './dueWording';
export type { DueDescription } from './dueWording';
