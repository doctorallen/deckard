/**
 * How far along a set of tasks is, as every progress figure says it: shown
 * as "3/8 done (38%)", and spoken as "3 of 8 done, 38%". A screen reader can
 * read "3/8" as a fraction or a date, and the bars beside the figures are
 * hidden from it, so wherever a figure is shown its spoken form is given too
 * (speakProgressText).
 */

/**
 * The share done as a whole percent. Only all of them is 100: 199 of 200
 * would round to a full, finished-looking 100%, so it stops at 99.
 */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return done >= total ? 100 : Math.max(0, Math.min(99, Math.round((done / total) * 100)));
}

/** How the figure is written: whole, or without "done" where a row has room for no more than the count. */
export interface ProgressCountOptions {
  readonly compact?: boolean;
}

/** "3/8 done (38%)", or "3/8 (38%)" compact: how many are done, of how many, and the share. */
export function formatProgressCount(done: number, total: number, options: ProgressCountOptions = {}): string {
  return `${done}/${total}${options.compact ? '' : ' done'} (${progressPercent(done, total)}%)`;
}

/** "3 of 8 done, 38%": the figure as a screen reader is given it. */
export function speakProgressCount(done: number, total: number): string {
  return `${done} of ${total} done, ${progressPercent(done, total)}%`;
}

/** Every figure formatProgressCount writes, whole or compact. */
const FIGURE = /(\d+)\/(\d+)(?: done)? \((\d+)%\)/g;

/**
 * Text with every progress figure in it put as it is spoken: "Steps 1/3 done
 * (33%) · next: Pack" becomes "Steps 1 of 3 done, 33% · next: Pack". Text with
 * no figure comes back as it was.
 */
export function speakProgressText(text: string): string {
  return text.replace(FIGURE, (_figure, done: string, total: string) => speakProgressCount(Number(done), Number(total)));
}
