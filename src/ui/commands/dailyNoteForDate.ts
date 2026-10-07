import * as vscode from 'vscode';

import {
  DatePhraseOptions,
  describeDay,
  describeDistance,
  formatShortDay,
  parseDatePhrase,
} from '../../domain/markdown/dates';
import { type DateFormats, formatDisplayDay } from '../../domain/markdown/dateFormat';
import type { IndexControl, IndexReader } from '../../core/workspace/indexReader';
import { chooseWorkspaceFolder, ensurePeriodicNote } from './dailyNote';
import { DATE_INPUT_ERROR, readDateFormats, readDateOptions } from './datePrompt';
import { openSourceAt } from './navigation';
import { createDailyNoteWithRollover } from './rollover';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { DailyNoteEntry, listDailyNotes, parseLocalDate } from '../../domain/notes/periodicNotes';
import { addDays, formatIsoDate, parseIsoDate, startOfDay } from '../../domain/markdown/calendar';

/**
 * Opening the daily note for any day named in words.
 *
 * Deckard opened today's note, and stepped to the one before or after, but
 * last Friday's note meant stepping back through each day in between, and a
 * note for a day ahead meant writing its file by hand.
 */

/** One row of the daily note picker, before it is a VS Code item. */
export interface DailyNotePick {
  label: string;
  description?: string;
  detail?: string;
  /** The day the row opens; absent on a heading or the error row. */
  date?: string;
  separator?: boolean;
}

const RECENT_LIMIT = 7;

/** A day's date in the reader's format with how far it is from today: `2026-09-22 · 3 days ago`. */
function describeDate(date: string, now: number, formats: DateFormats | undefined): string {
  const at = parseIsoDate(date);
  const distance = at === undefined ? undefined : describeDistance(at, now);
  const written = formatDisplayDay(date, formats);
  return distance ? `${written} · ${distance}` : written;
}

/**
 * The rows the picker shows: yesterday, today, tomorrow, and the newest daily
 * notes when nothing is typed; the day typed, or the one error, when
 * something is. Each day is written in the reader's `options.formats`.
 */
export function buildDailyNotePicks(
  notes: readonly DailyNoteEntry[],
  typed: string,
  now: number = Date.now(),
  options: DatePhraseOptions & { readonly formats?: DateFormats } = {},
): DailyNotePick[] {
  const { formats } = options;
  const today = startOfDay(now);
  if (typed.trim()) {
    const date = parseDatePhrase(typed, now, options)?.date;
    if (!date) {
      return [{ label: `$(info) ${DATE_INPUT_ERROR}` }];
    }
    const exists = notes.some((note) => note.date === date);
    return [
      {
        label: `$(calendar) Open daily note for ${formatShortDay(date, now, formats)}`,
        description: describeDate(date, now, formats),
        ...(exists ? {} : { detail: 'Creates it from the daily note template' }),
        date,
      },
    ];
  }
  const named = [
    ['Yesterday', formatIsoDate(addDays(today, -1))],
    ['Today', formatIsoDate(today)],
    ['Tomorrow', formatIsoDate(addDays(today, 1))],
  ] as const;
  const picks: DailyNotePick[] = named.map(([label, date]) => ({
    label,
    description: describeDay(date, now, formats),
    date,
  }));
  const shown = new Set<string>(named.map(([, date]) => date));
  const recent = [...notes]
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter((note) => {
      if (shown.has(note.date)) {
        return false;
      }
      shown.add(note.date);
      return true;
    })
    .slice(0, RECENT_LIMIT);
  if (recent.length > 0) {
    picks.push({ label: 'Recent daily notes', separator: true });
    picks.push(
      ...recent.map((note) => ({
        label: formatShortDay(note.date, now, formats),
        description: describeDate(note.date, now, formats),
        date: note.date,
      })),
    );
  }
  return picks;
}

type DailyNoteIndexer = Pick<IndexReader & IndexControl, 'ready' | 'getSnapshot' | 'refresh'>;

/**
 * Opens a day's note: the one the index has, today's through rollover, or a
 * new one from the template. The row that led here already said it would
 * create one, so it is not asked again.
 */
export async function openDailyNoteFor(
  indexer: DailyNoteIndexer,
  history: WorkspaceWriteHistory,
  date: string,
): Promise<void> {
  await indexer.ready;
  const existing = listDailyNotes(indexer.getSnapshot()).find((note) => note.date === date);
  if (existing) {
    await openSourceAt({ filePath: existing.filePath, line: 1 });
    return;
  }
  if (date === formatIsoDate(startOfDay(Date.now()))) {
    await createDailyNoteWithRollover(indexer, history);
    return;
  }
  const day = parseLocalDate(date);
  const folder = day ? await chooseWorkspaceFolder() : undefined;
  if (!day || !folder) {
    return;
  }
  const uri = await ensurePeriodicNote(folder, 'day', day);
  await vscode.window.showTextDocument(uri, { preview: false });
}

/** Deckard: Open Daily Note for Date…, a picker that reads a day in words. */
export async function openDailyNoteForDate(
  indexer: DailyNoteIndexer,
  history: WorkspaceWriteHistory,
): Promise<void> {
  await indexer.ready;
  const notes = listDailyNotes(indexer.getSnapshot());
  const options = { ...readDateOptions(), formats: readDateFormats() };
  const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { date?: string }>();
  picker.title = 'Open a daily note';
  picker.placeholder = 'A day in plain words, such as last friday, oct 3, or 2026-10-02';
  // The rows are the day typed, not a list to filter.
  picker.matchOnDescription = false;
  picker.matchOnDetail = false;
  const draw = (): void => {
    picker.items = buildDailyNotePicks(notes, picker.value, Date.now(), options).map((pick) =>
      pick.separator
        ? { label: pick.label, kind: vscode.QuickPickItemKind.Separator }
        : {
            label: pick.label,
            description: pick.description,
            detail: pick.detail,
            date: pick.date,
            alwaysShow: true,
          },
    );
  };
  picker.onDidChangeValue(draw);
  picker.onDidAccept(() => {
    const date = picker.activeItems[0]?.date;
    if (!date) {
      return;
    }
    picker.hide();
    void openDailyNoteFor(indexer, history, date);
  });
  picker.onDidHide(() => picker.dispose());
  draw();
  picker.show();
}
