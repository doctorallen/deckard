import { getExtractedNoteFileName } from '../markdown/noteNames';
import { WorkspaceIndex } from '../model';
import {
  createNoteTitleMap,
  findWikiTargetPaths,
  parseWikiTarget,
} from '../index/backlinks';
import { findWikiLinkSpans } from '../markdown/wikiLinks';

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
 * notes share. Links in code and `[[#Heading]]` links into the note
 * itself are left alone, as is a heading a note lacks, since the link still
 * opens the note.
 */
export function findLinkProblems(
  content: string,
  index: WorkspaceIndex,
  sourcePath: string,
): LinkProblem[] {
  const titles = createNoteTitleMap(index);
  const problems: LinkProblem[] = [];
  for (const span of findWikiLinkSpans(content)) {
    const { note } = parseWikiTarget(span.target);
    if (!note) {
      continue;
    }
    const paths = findWikiTargetPaths(titles, note, sourcePath);
    if (paths.length === 1) {
      continue;
    }
    problems.push({
      line: span.line,
      startColumn: span.startColumn,
      endColumn: span.endColumn,
      name: note,
      kind: paths.length === 0 ? 'missing' : 'ambiguous',
      paths: [...paths].sort(),
    });
  }
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
