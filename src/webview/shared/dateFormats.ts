/**
 * The reader's date formats, as the page shell wrote them on the body:
 * `deckard.display.dateFormat` and `shortDateFormat`, the display language
 * `L` to `llll` follow, and the week start `w` counts from, each only when
 * it isn't the default. A page writes every date it formats itself through
 * these, as the host writes the dates it words.
 */
import { createDateFormats, type DateFormats, type DateKind, formatDisplayDate, formatDisplayDay } from '../../domain/markdown/dateFormat';

/** The formats, read from the body each time a page draws, so a redraw after a change follows it. */
export function readDateFormats(): DateFormats {
  const body = typeof document === 'undefined' ? undefined : document.body.dataset;
  return createDateFormats({
    date: body?.dateFormat,
    short: body?.shortDateFormat,
    locale: body?.dateLocale,
    weekStart: body?.weekStart,
  });
}

/** A moment in the reader's format; a short date in another year than `now`'s is written in full. */
export function formatPageDate(at: number, kind: DateKind = 'date', now?: number): string {
  return formatDisplayDate(at, readDateFormats(), kind, now);
}

/** A `YYYY-MM-DD` date in the reader's format, as formatPageDate writes its day. */
export function formatPageDay(date: string, kind: DateKind = 'date', now?: number): string {
  return formatDisplayDay(date, readDateFormats(), kind, now);
}
