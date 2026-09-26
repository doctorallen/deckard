import * as vscode from 'vscode';

import {
  DatePhraseOptions,
  describeDay,
  parseDatePhrase,
} from '../../core/markdown/dates';

/**
 * The one date box.
 *
 * Every box that asks for a date reads the same words, says back the day it
 * read as it is typed, and gives the same message when it cannot read one,
 * so a date typed in the task editor, a bulk edit, or a reschedule means the
 * same day.
 */

/** The one message for words that are not a day. */
export const DATE_INPUT_ERROR = 'Enter a date such as friday, in 3 days, or 2026-10-02.';

/** The one prompt under a date box. */
export const DATE_INPUT_PROMPT =
  'A date in plain words: friday, oct 3, next week, end of month, in 3 days, or 2026-10-02. Leave it empty to clear it.';

/**
 * The order a numeric date is read in, from VS Code's display language: day
 * first where the language writes the day first, month first otherwise.
 */
export function numericOrderFor(language: string): 'mdy' | 'dmy' {
  try {
    const parts = new Intl.DateTimeFormat(language).formatToParts(new Date(2026, 9, 3));
    const day = parts.findIndex((part) => part.type === 'day');
    const month = parts.findIndex((part) => part.type === 'month');
    return day !== -1 && month !== -1 && day < month ? 'dmy' : 'mdy';
  } catch {
    return 'mdy';
  }
}

/** How a date box reads what is typed into it. */
export function readDateOptions(): DatePhraseOptions {
  return {
    weekStart: 0,
    numericOrder: numericOrderFor(vscode.env.language),
  };
}

/**
 * What a date box says as it is typed: the day it read, the one error, or
 * nothing for an empty box, which clears the date.
 */
export function validateDateInput(
  value: string,
  now: number = Date.now(),
  options: DatePhraseOptions = {},
): string | vscode.InputBoxValidationMessage | undefined {
  const read = parseDatePhrase(value, now, options);
  if (!read) {
    return DATE_INPUT_ERROR;
  }
  // Saying the day back is the point of accepting words for one.
  return read.date
    ? {
        message: describeDay(read.date, now),
        severity: vscode.InputBoxValidationSeverity.Info,
      }
    : undefined;
}

/**
 * Asks for a date in plain words. Returns `{ date }`, `{ date: undefined }`
 * for an empty answer, which clears the date, or undefined when the box was
 * closed.
 */
export async function askForDate(ask: {
  title: string;
  value?: string;
  now?: number;
}): Promise<{ date: string | undefined } | undefined> {
  const now = ask.now ?? Date.now();
  const options = readDateOptions();
  const written = await vscode.window.showInputBox({
    title: ask.title,
    prompt: DATE_INPUT_PROMPT,
    placeHolder: 'friday',
    value: ask.value ?? '',
    ignoreFocusOut: true,
    validateInput: (value) => validateDateInput(value, now, options),
  });
  if (written === undefined) {
    return undefined;
  }
  return parseDatePhrase(written, now, options);
}
