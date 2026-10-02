import { getExtractedNoteFileName } from '../markdown/noteNames';
import { WorkspaceIndex } from '../model';
import {
  createNoteTitleMap,
  findWikiTargetPaths,
  parseWikiTarget,
  WIKI_LINK,
} from '../index/backlinks';
import { findFencedLines } from '../markdown/lineShapes';

/** A `[[link]]` that opens no note. */
export interface LinkProblem {
  /** Zero-based line, and the columns of the whole `[[…]]`. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The note name the link uses, as written. */
  name: string;
  /** No note has the name, or several do. */
  kind: 'missing' | 'ambiguous';
  /** The notes that share the name, when several do. */
  paths: readonly string[];
}

/**
 * The links in a note that open no note: a name no note has, or one several
 * notes share. Links in code fences and `[[#Heading]]` links into the note
 * itself are left alone, as is a heading a note lacks, since the link still
 * opens the note.
 */
export function findLinkProblems(
  content: string,
  index: WorkspaceIndex,
  sourcePath: string,
): LinkProblem[] {
  const titles = createNoteTitleMap(index);
  const lines = content.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  const problems: LinkProblem[] = [];
  lines.forEach((text, line) => {
    if (fenced.has(line)) {
      return;
    }
    for (const match of text.matchAll(WIKI_LINK)) {
      const { note } = parseWikiTarget(match[1]);
      if (!note) {
        continue;
      }
      const paths = findWikiTargetPaths(titles, note, sourcePath);
      if (paths.length === 1) {
        continue;
      }
      const startColumn = match.index ?? 0;
      problems.push({
        line,
        startColumn,
        endColumn: startColumn + match[0].length,
        name: note,
        kind: paths.length === 0 ? 'missing' : 'ambiguous',
        paths: [...paths].sort(),
      });
    }
  });
  return problems;
}

/**
 * The note names a note's missing links use, once each whatever their letter
 * case, that could be file names. A name several notes share is not missing:
 * another note would only make it more ambiguous.
 */
export function findMissingNoteNames(
  problems: readonly LinkProblem[],
): string[] {
  const names = new Map<string, string>();
  for (const problem of problems) {
    const key = problem.name.trim().toLocaleLowerCase();
    if (
      problem.kind === 'missing' &&
      !names.has(key) &&
      getExtractedNoteFileName(problem.name)
    ) {
      names.set(key, problem.name.trim());
    }
  }
  return [...names.values()];
}
