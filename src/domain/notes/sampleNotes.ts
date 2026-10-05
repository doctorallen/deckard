import { formatLocalDate } from './periodicNotes';

/**
 * The shipped sample's notes as installed: its date tokens as the days they
 * name, and its file names as written. Kept apart from the command that
 * installs the sample, which needs VS Code, so the suites that index the
 * sample as a corpus run without it.
 */

/** A day `offset` days from `today`, as the sample writes dates. */
function sampleDate(today: Date, offset: number): string {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return formatLocalDate(day);
}

/**
 * `{{date}}`, `{{date-9}}`, and `{{date+3}}` as the days they name, and
 * `{{month+1}}` or `{{month-1}}` as the 15th of that month, for a task due
 * next month or a note written last month whatever day it is made.
 */
export function resolveSampleTokens(text: string, today: Date): string {
  return text
    .replace(/\{\{date(?:([+-])(\d+))?\}\}/g, (_whole, sign?: string, days?: string) =>
      sampleDate(today, sign ? (sign === '-' ? -1 : 1) * Number(days) : 0),
    )
    .replace(/\{\{month([+-])(\d+)\}\}/g, (_whole, sign: string, months: string) =>
      formatLocalDate(
        new Date(today.getFullYear(), today.getMonth() + (sign === '-' ? -1 : 1) * Number(months), 15),
      ),
    );
}

/** A shipped name as installed: `day-9.md` is that day's daily note, `dot-vscode` is `.vscode`. */
export function sampleFileName(name: string, today: Date): string {
  const day = /^day-(\d+)\.md$/.exec(name);
  if (day) {
    return `${sampleDate(today, -Number(day[1]))}.md`;
  }
  return name === 'dot-vscode' ? '.vscode' : name;
}
