import { ParsedFile } from '../model';

/**
 * The tagged entries of a note that the editor marks: each tagged section,
 * inline block, and task, and which of them holds a line. The tag
 * decorations in `ui/providers` draw the band and the hovers from these.
 */

/** A tagged section or task in the editor: what the band and hover cover. */
export interface EditorEntry {
  startLine: number;
  endLine: number;
  title: string;
}

/**
 * The entries a note's hovers and band cover: sections with heading tags,
 * tagged inline blocks, and tagged tasks.
 */
export function collectTaggedEntries(
  parsed: Pick<ParsedFile, 'sections' | 'tasks'>,
): EditorEntry[] {
  const entries: EditorEntry[] = [];
  parsed.sections
    .filter(
      (section) =>
        (section.headingTags?.length ?? 0) > 0 ||
        (section.isInline && (section.associationTagGroups?.length ?? 0) > 0),
    )
    .forEach((section) =>
      entries.push({
        startLine: section.startLine,
        endLine: section.endLine,
        title: section.heading,
      }),
    );
  parsed.tasks
    .filter((task) => (task.associationTagGroups?.length ?? 0) > 0)
    .forEach((task) =>
      entries.push({
        startLine: task.lineNumber,
        endLine: task.lineNumber,
        title: task.title,
      }),
    );
  return entries;
}

/**
 * The innermost entry holding a line (1-based): the one with the smallest
 * span, and of two alike, the one that starts later.
 */
export function findBandEntry(
  entries: readonly EditorEntry[],
  line: number,
): EditorEntry | undefined {
  let best: EditorEntry | undefined;
  for (const entry of entries) {
    if (line < entry.startLine || line > entry.endLine) {
      continue;
    }
    const span = entry.endLine - entry.startLine;
    const bestSpan = best ? best.endLine - best.startLine : Infinity;
    if (!best || span < bestSpan || (span === bestSpan && entry.startLine > best.startLine)) {
      best = entry;
    }
  }
  return best;
}
