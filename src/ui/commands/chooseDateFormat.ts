import * as vscode from 'vscode';

import {
  createDateFormats,
  DEFAULT_DATE_FORMAT,
  formatDisplayDate,
  isReadableDateFormat,
  type DateFormats,
} from '../../domain/markdown/dateFormat';
import { DATE_FORMAT_SETTINGS, readDateFormats } from './datePrompt';
import { writeSetting } from './settings';

/**
 * Choose Date Format…: a few formats, each showing today in it, and
 * Custom…, a box that says today back in the format as it is typed. The
 * choice is written to the user's settings, as every Display setting is, and
 * the open pages redraw from the setting's own change.
 */

/** The formats offered, the one Deckard ships first; `L` and `LL` are the display language's own. */
export const DATE_FORMAT_PRESETS: readonly string[] = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'D MMM YYYY',
  'ddd, MMM D, YYYY',
  'L',
  'LL',
];

/** What each preset is, where its tokens do not say it. */
const PRESET_NOTES: Readonly<Record<string, string>> = {
  'YYYY-MM-DD': 'As notes write it',
  L: "Your display language's short date",
  LL: "Your display language's long date",
};

/** A picker row: a format, or Custom…. */
export interface DateFormatItem extends vscode.QuickPickItem {
  readonly format?: string;
  readonly custom?: true;
}

/**
 * The rows: each preset as today written in it, its tokens beside, the one
 * in use marked; then Custom…, which names the format in use when it is
 * none of the presets.
 */
export function createDateFormatItems(formats: DateFormats, now: number): DateFormatItem[] {
  const presets: DateFormatItem[] = DATE_FORMAT_PRESETS.map((format) => ({
    label: formatDisplayDate(now, { ...formats, date: format }),
    description: [format, format === formats.date ? 'In use' : ''].filter(Boolean).join(' · '),
    ...(PRESET_NOTES[format] ? { detail: PRESET_NOTES[format] } : {}),
    format,
  }));
  const own = DATE_FORMAT_PRESETS.includes(formats.date) ? undefined : formats.date;
  return [
    ...presets,
    { label: 'More', kind: vscode.QuickPickItemKind.Separator },
    {
      label: 'Custom…',
      description: own ? `${own} · In use` : 'Your own, in the tokens Obsidian uses',
      custom: true,
    },
  ];
}

/**
 * What the Custom… box says as a format is typed: today in it, or why it
 * writes no date. An empty box puts the default back.
 */
export function describeTypedFormat(typed: string, formats: DateFormats, now: number): vscode.InputBoxValidationMessage | string {
  const format = typed.trim();
  if (!format) {
    return { message: `Empty puts back ${DEFAULT_DATE_FORMAT}: ${formatDisplayDate(now, { ...formats, date: DEFAULT_DATE_FORMAT })}`, severity: vscode.InputBoxValidationSeverity.Info };
  }
  if (!isReadableDateFormat(format)) {
    return 'This format writes no part of a date. Use tokens such as YYYY, MM, DD, MMM, or ddd; put words in [brackets].';
  }
  return { message: `Today: ${formatDisplayDate(now, { ...formats, date: format })}`, severity: vscode.InputBoxValidationSeverity.Info };
}

/** Writes the format to the user's settings; the default is written as no value, so Settings shows it unchanged. */
async function writeDateFormat(format: string): Promise<void> {
  const value = createDateFormats({ date: format }).date;
  await writeSetting(DATE_FORMAT_SETTINGS.date, value === DEFAULT_DATE_FORMAT ? undefined : value, vscode.ConfigurationTarget.Global);
}

/** Asks for a format of the reader's own, starting from the one in use. */
async function askForFormat(formats: DateFormats, now: number): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Deckard date format',
    prompt: 'YYYY year, MM or M month, MMM Oct, MMMM October, DD or D day, Do 2nd, ddd Fri, dddd Friday, W week; text in [brackets] as it is',
    value: formats.date,
    ignoreFocusOut: true,
    validateInput: (typed) => describeTypedFormat(typed, formats, now),
  });
}

/** Runs Choose Date Format…, and writes the format chosen, if one was. */
export async function chooseDateFormat(): Promise<void> {
  const now = Date.now();
  const formats = readDateFormats();
  const items = createDateFormatItems(formats, now);
  const chosen = await vscode.window.showQuickPick(items, {
    title: 'Deckard date format',
    placeHolder: 'How should Deckard write a date for you to read? Dates in notes stay YYYY-MM-DD.',
  });
  if (!chosen) {
    return;
  }
  // The box refuses a format that writes no date, so what it gives is written.
  const format = chosen.custom ? await askForFormat(formats, now) : chosen.format;
  if (format !== undefined) {
    await writeDateFormat(format);
  }
}
