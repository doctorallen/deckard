/**
 * How recent a note is, for the small boost Related Notes gives a recently
 * dated one: the date it gives itself, else its daily note's, else when it
 * was last saved.
 */
import { ParsedFile } from '../model';
import { getDailyNoteDate } from './entryLabels';

/** When a note is dated, and what the date was read from, as a reason says it. */
export interface RelevantDate {
  at: number;
  source: string;
}

/**
 * A note's date: a `date`, `created`, or `updated` in its front matter, else
 * the day its daily-note name or heading gives, else when it was saved.
 */
export function getRelevantDate(file: ParsedFile): RelevantDate | undefined {
  const frontmatterBlock = file.content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/,
  )?.[1];
  const frontmatter = frontmatterBlock?.match(
    /^(?:date|created|updated):\s*["']?(\d{4}-\d{2}-\d{2})/im,
  )?.[1];
  const dailyDate = getDailyNoteDate(file);
  const date = frontmatter ?? dailyDate;
  if (date) {
    const at = new Date(`${date}T00:00:00`).getTime();
    if (!Number.isNaN(at)) {
      return { at, source: frontmatter ? 'dated note' : `daily note ${date}` };
    }
  }
  return file.updatedAt === undefined
    ? undefined
    : { at: file.updatedAt, source: 'updated note' };
}

/**
 * A small boost for a recently dated note, halving every `halfLifeDays` of
 * age counted to `now`, or 0 when the decay is off or the note has no date.
 */
export function getRecencyWeight(
  date: { at: number } | undefined,
  halfLifeDays: number | undefined,
  now: number,
): number {
  if (!date || !halfLifeDays || halfLifeDays <= 0) {
    return 0;
  }
  const ageDays = Math.max(0, (now - date.at) / 86_400_000);
  return 0.1 * 2 ** (-ageDays / halfLifeDays);
}
