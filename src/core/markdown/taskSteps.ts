import { Task, TaskSteps } from '../types';
import {
  findListParents,
  findParentTaskLine,
  isTaskItemLine,
  lineIndent,
} from './listNesting';
import { isTaskLineOf, matchTaskLine, TaskLineShape } from './lineShapes';
import { stripTags } from './parser';
import { setTaskLineCompletion } from './taskMetadata';

/**
 * Steps: checkbox tasks written under a task, and what Deckard says and
 * writes about them. Pure, so the parser's rule, the views' wording, and
 * the writes can all be tested without VS Code.
 */

/** How a task's steps read, in two parts a card can style apart. */
export interface StepsDescription {
  /** `2 of 5 steps`, or `All 5 steps done`. */
  label: string;
  /** The first open step's title, trailing tags left off. */
  next?: string;
}

/** `2 of 5 steps` and the next open step, for a card that styles them apart. */
export function describeStepParts(steps: TaskSteps): StepsDescription {
  const noun = steps.total === 1 ? 'step' : 'steps';
  if (steps.done >= steps.total) {
    return {
      label: steps.total === 1 ? '1 of 1 step done' : `All ${steps.total} steps done`,
    };
  }
  const next = steps.next === undefined ? undefined : stripTrailingTagWords(steps.next);
  return {
    label: `${steps.done} of ${steps.total} ${noun}`,
    ...(next ? { next } : {}),
  };
}

/** `2 of 5 steps · next: Draft the email`, in one line. */
export function describeSteps(steps: TaskSteps): string {
  const { label, next } = describeStepParts(steps);
  return next ? `${label} · next: ${next}` : label;
}

/** A title without the tags written at its end, as card titles are shown. */
function stripTrailingTagWords(text: string): string {
  const words = text.trim().split(/\s+/);
  while (words.length > 1 && stripTags(words[words.length - 1]) === '') {
    words.pop();
  }
  return words.join(' ');
}

/**
 * Whether a step carries nothing of its own to sort by: no date, priority,
 * person, or tag written on its line. Such a step is shown on its task's
 * card or row rather than on its own.
 */
export function isPlainStep(task: Task): boolean {
  return (
    task.parentTaskId !== undefined &&
    task.dueAt === undefined &&
    task.scheduledAt === undefined &&
    task.startAt === undefined &&
    task.priority === undefined &&
    task.assignee === undefined &&
    (task.associationTagGroups?.[0]?.length ?? 0) === 0
  );
}

/**
 * The tasks to list, with each plain step left out when its task is listed
 * too: the task's card or row carries it. A step with a date, priority,
 * person, or tag of its own stays, and so does a step whose task is not in
 * the list.
 */
export function foldSteps<T extends Task>(tasks: readonly T[]): T[] {
  const listed = new Set(tasks.map((task) => task.id));
  return tasks.filter(
    (task) =>
      task.parentTaskId === undefined ||
      !listed.has(task.parentTaskId) ||
      !isPlainStep(task),
  );
}

/** A task line's place among its steps and its parent, by line index. */
export interface StepFamily {
  /** The line of the task this line is a step of. */
  parent?: number;
  /** The lines of this task's direct steps, in order. */
  steps: number[];
}

/**
 * The task a line is a step of, and its own direct steps, read from the
 * note's lines by the parser's rule. Line indexes are 0-based.
 */
export function findStepFamily(lines: readonly string[], lineIndex: number): StepFamily {
  const parents = findListParents(lines);
  const parent = findParentTaskLine(lines, parents, lineIndex);
  const steps: number[] = [];
  parents.forEach((parentLine, line) => {
    if (parentLine === lineIndex && isTaskItemLine(lines[line])) {
      steps.push(line);
    }
  });
  steps.sort((left, right) => left - right);
  return { ...(parent !== undefined ? { parent } : {}), steps };
}

/** A checked task, `[x]` or `[X]`, indented by spaces and tabs only. */
const CHECKED_TASK: TaskLineShape = { indent: 'spaces-and-tabs', marks: 'xX' };
/** A bullet and the `[` of a box, whatever follows it. */
const BOX_OPENING: TaskLineShape = { indent: 'spaces-and-tabs', marks: 'unread' };

/** Whether a task line is checked. */
export function isCheckedTaskLine(line: string): boolean {
  return isTaskLineOf(line, CHECKED_TASK);
}

/** The 0-based column of a task line's checkbox mark, between its brackets. */
export function findCheckboxColumn(line: string): number {
  const match = matchTaskLine(line, BOX_OPENING);
  return match ? match.opening.length : -1;
}

/**
 * The last line that belongs to a list item: its indented descendants and
 * their continuation lines, not the blank lines after them. 0-based.
 */
export function findLastDescendantLine(lines: readonly string[], lineIndex: number): number {
  const indent = lineIndent(lines[lineIndex]);
  let last = lineIndex;
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      continue;
    }
    if (lineIndent(line) <= indent || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) {
      break;
    }
    last = index;
  }
  return last;
}

/** Where new steps go under a task, and how they are written. */
export interface StepInsertion {
  /** The 0-based line the steps are written after. */
  afterLine: number;
  /** The whitespace each step line starts with. */
  indent: string;
  marker: '-' | '*' | '+';
}

/**
 * Where to write new steps under a task: after everything already under it,
 * indented as its first step is, or as the note already nests its lists,
 * or two spaces in from the task, where its words start.
 */
export function planStepInsertion(lines: readonly string[], taskLineIndex: number): StepInsertion {
  const taskLine = lines[taskLineIndex];
  const taskIndent = taskLine.match(/^[ \t]*/)?.[0] ?? '';
  const marker = (taskLine.trim()[0] ?? '-') as '-' | '*' | '+';
  const family = findStepFamily(lines, taskLineIndex);
  const firstStep = family.steps[0];
  return {
    afterLine: findLastDescendantLine(lines, taskLineIndex),
    indent:
      firstStep !== undefined
        ? lines[firstStep].match(/^[ \t]*/)?.[0] ?? ''
        : taskIndent + readNestingStep(lines, taskIndent),
    marker: marker === '*' || marker === '+' ? marker : '-',
  };
}

/**
 * How much further in the note already writes a nested list item than its
 * parent: the first nested item's difference, else a tab in a note indented
 * with tabs, else two spaces.
 */
function readNestingStep(lines: readonly string[], taskIndent: string): string {
  const parents = findListParents(lines);
  for (const [line, parent] of parents) {
    if (parent === undefined) {
      continue;
    }
    const outer = lines[parent].match(/^[ \t]*/)?.[0] ?? '';
    const inner = lines[line].match(/^[ \t]*/)?.[0] ?? '';
    if (inner.startsWith(outer) && inner.length > outer.length) {
      return inner.slice(outer.length);
    }
  }
  return taskIndent.includes('\t') ? '\t' : '  ';
}

/** New steps as the lines to write, unchecked. */
export function formatStepLines(
  steps: readonly string[],
  indent: string,
  marker: '-' | '*' | '+' = '-',
): string[] {
  return steps.map((step) => `${indent}${marker} [ ] ${step}`);
}

/**
 * A step as typed, tidied: a leading bullet, number, or checkbox is taken
 * off, since Deckard writes its own, and runs of whitespace collapse.
 */
export function cleanStepText(text: string): string {
  return text
    .replace(/^\s*(?:(?:[-*+•]|\d+[.)])\s+)?(?:\[[ xX]?\]\s*)?/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Typed text as steps: one per line, blanks left out. */
export function splitTypedSteps(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(cleanStepText)
    .filter((step) => step.length > 0);
}

/** The most steps a suggestion adds, and the longest one kept. */
const MAX_SUGGESTED_STEPS = 10;
const MAX_STEP_LENGTH = 120;

/**
 * A language model's reply as steps: one per line, numbering and bullets
 * taken off, a lead-in such as "Here are the steps:" left out, each cut to
 * 120 characters, ten at most.
 */
export function parseSuggestedSteps(reply: string): string[] {
  return reply
    .split(/\r?\n/)
    .map((line) => cleanStepText(line.replace(/\*\*/g, '')))
    .filter((line) => line.length > 0 && !line.endsWith(':'))
    .map((line) =>
      line.length > MAX_STEP_LENGTH ? `${line.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…` : line,
    )
    .slice(0, MAX_SUGGESTED_STEPS);
}

/**
 * The steps a repeating task's next occurrence takes: its direct steps,
 * each unchecked with its done date taken off.
 */
export function readStepsForNextOccurrence(lines: readonly string[], lineIndex: number): string[] {
  return findStepFamily(lines, lineIndex).steps.map((line) => resetStepLine(lines[line]));
}

/**
 * A step copied for a task's next occurrence: unchecked, with its done date
 * taken off, the rest as written.
 */
export function resetStepLine(line: string): string {
  const column = findCheckboxColumn(line);
  return column < 0 ? line : setTaskLineCompletion(line, column, false);
}
