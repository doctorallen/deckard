import * as vscode from 'vscode';

import { findFencedLines } from '../../domain/markdown/lineShapes';
import type { ParsedFile } from '../../domain/model';
import { resolveSourceUri } from './navigation';

/**
 * The searches written in notes, rewritten: a change that renames what a
 * search says, such as a status renamed or a status tag moved into its
 * character, carries into the query blocks that say it, as edits the
 * caller writes through the refactor preview.
 */

/** The fences whose lines are searches: a query block, and a block of searches to copy. */
const SEARCH_FENCE = /^\s*(`{3,}|~{3,})\s*(deckard|search)\b/;

/** What rewriting the query blocks made: the edit, how many lines it changes, and where, by note and zero-based line. */
export interface QueryBlockEdits {
  edit: vscode.WorkspaceEdit;
  lines: number;
  /** Each changed line, as `uri:line`. */
  places: string[];
}

/**
 * The lines of query blocks in the notes that `rewrite` changes, written
 * into `edit`. A note whose text `mentions` does not match is skipped
 * unread, since most notes have no search in them.
 */
export async function findQueryBlockEdits(
  files: Iterable<Pick<ParsedFile, 'filePath' | 'content'>>,
  rewrite: (query: string) => string,
  mentions: RegExp,
  edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit(),
): Promise<QueryBlockEdits> {
  const places: string[] = [];
  for (const file of files) {
    if (!mentions.test(file.content)) {
      continue;
    }
    const text = file.content.split(/\r?\n/);
    const fenced = findFencedLines(text);
    const uri = await resolveSourceUri(file.filePath);
    let inSearch = false;
    text.forEach((line, at) => {
      if (!fenced.has(at)) {
        inSearch = false;
        return;
      }
      if (SEARCH_FENCE.test(line)) {
        inSearch = true;
        return;
      }
      const rewritten = inSearch ? rewrite(line) : line;
      if (!uri || rewritten === line) {
        return;
      }
      edit.replace(uri, new vscode.Range(at, 0, at, line.length), rewritten);
      places.push(`${uri.toString()}:${at}`);
    });
  }
  return { edit, lines: places.length, places };
}
