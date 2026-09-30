import { readCaptureText } from '../markdown/captureWords';
import { DatePhraseOptions } from '../markdown/dates';
import { isTaskLineOf, TaskLineShape } from '../markdown/lineShapes';
import { TaskMetadataFormat } from '../markdown/taskMetadata';
import { Section } from '../model';

/**
 * How Capture writes what was typed, and where in a note it goes. Pure, so
 * the Capture box, Find's Capture row, and the board's capture all write the
 * same line, and a test can pin every rule.
 */

/** Where a captured line is inserted, and the line the task ends up on. */
export interface CaptureInsertion {
  line: number;
  character: number;
  text: string;
  /** The zero-based line of the added task once the text is inserted. */
  taskLine: number;
}

/**
 * How a capture is read: the task metadata format and the day and date
 * rules its last words are read with, the moment they are read at, and
 * whether it is kept as typed or written as a plain note line.
 */
export interface CaptureLineOptions {
  format: TaskMetadataFormat;
  now: number;
  dateOptions: DatePhraseOptions;
  /** The words kept as typed, with no date or priority read from them. */
  literal?: boolean;
  /** A plain list item rather than a task. */
  asNote?: boolean;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/** A task written as Deckard writes one: no indent, and one space either side of the box. */
const WRITTEN_TASK: TaskLineShape = { indent: 'none', bulletGap: 'one-space', marks: ' xX', after: 'one-space' };

/**
 * The line a capture is written as: a note line, the task as typed, or the
 * task with the date, priority, and repeat rule its last words name, read
 * on the day `options.now` falls on.
 */
export function writeCapture(text: string, options: CaptureLineOptions): string {
  if (options.asNote === true) {
    return formatNoteLine(text);
  }
  const line = formatCaptureLine(text);
  return options.literal === true
    ? line
    : readCaptureText(line, options.format, options.now, options.dateOptions).line;
}

/** Writes a capture as a plain list item, for an idea that is not a to-do. */
export function formatNoteLine(text: string): string {
  return `- ${text.trim().replace(/^[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/, '')}`;
}

/** Writes a capture as an open task, unless it is already written as a task. */
export function formatCaptureLine(text: string): string {
  const trimmed = text.trim();
  return isTaskLineOf(trimmed, WRITTEN_TASK)
    ? trimmed
    : `- [ ] ${trimmed.replace(/^[-*+]\s+/, '')}`;
}

/**
 * Places a captured line after the last list item in the note or section, or
 * after a blank line below its last text. A section's lines are one-based.
 */
export function getCaptureInsertion(
  content: string,
  line: string,
  section?: Pick<Section, 'startLine' | 'endLine'>,
): CaptureInsertion {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const first = section ? section.startLine - 1 : 0;
  let end = section
    ? Math.min(section.endLine, lines.length) - 1
    : lines.length - 1;
  while (end >= first && lines[end].trim() === '') {
    end -= 1;
  }
  if (end < first) {
    return { line: 0, character: 0, text: `${line}${eol}`, taskLine: 0 };
  }

  const gap = LIST_ITEM.test(lines[end]) ? '' : eol;
  const taskLine = end + (gap ? 2 : 1);
  if (end + 1 < lines.length) {
    return { line: end + 1, character: 0, text: `${gap}${line}${eol}`, taskLine };
  }
  // The last text ends the file without a line break.
  return {
    line: end,
    character: lines[end].length,
    text: `${eol}${gap}${line}`,
    taskLine,
  };
}

/**
 * Finds the heading chosen from the index in the note as it is now, by its
 * text, its level, and how many headings like it come before it.
 */
export function findSameSection(
  saved: readonly Section[],
  chosen: Section,
  live: readonly Section[],
): Section | undefined {
  const same = (section: Section) =>
    !section.isInline &&
    section.heading === chosen.heading &&
    section.headingLevel === chosen.headingLevel;
  const occurrence = saved
    .filter(same)
    .findIndex((section) => section.id === chosen.id);
  return occurrence < 0 ? undefined : live.filter(same)[occurrence];
}
