import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as vscode from 'vscode';

import { ParsedFile } from '../types';
import {
  CacheChanges,
  compareToStored,
  createNoteToWrite,
  openSearchDatabase,
  SearchWriter,
  StoredNote,
} from './searchDatabase';
import { SearchWorkerClient } from './searchStoreWorkerClient';

export interface StoredSearchMatch {
  filePath: string;
  excerpt: string;
}

/** One note section, task, or front-matter-only file that matched a search. */
export interface EntrySearchMatch {
  kind: 'section' | 'task' | 'file';
  /** The section or task id, or the file path of a front-matter-only file. */
  id: string;
  filePath: string;
  line: number;
  /** Relevance, higher first. Only comparable within one search. */
  score: number;
  excerpt: string;
}

export interface EntrySearchResult {
  matches: EntrySearchMatch[];
  /**
   * True when no entry had every word, so the matches are entries with any
   * of them.
   */
  partial: boolean;
  /**
   * The search with a misspelled word replaced by a close word from the
   * notes, offered when nothing matched at all.
   */
  suggestion?: string;
}

export interface EntrySearchOptions {
  limit?: number;
  /** Match the last word as a prefix, for results while it is being typed. */
  prefixLastTerm?: boolean;
}

/**
 * Relevance weights for the title, headings, tags, and body columns, in that
 * order. A word in a title says far more about an entry than the same word
 * somewhere in its body, as Omnisearch weights file names and headings.
 */
const COLUMN_WEIGHTS = '10.0, 4.0, 6.0, 1.0';

/**
 * How many notes a scan has to write before the work is worth another
 * thread. A handful of notes is faster written here than sent anywhere.
 */
const WORKER_THRESHOLD = 25;

/**
 * Maintains a private, workspace-scoped full-text index. The database is a
 * cache: Markdown files remain the source of truth and are reindexed at start.
 *
 * Each note section, task, and front-matter-only file is its own row, so a
 * search ranks the entry that matched rather than the whole file around it.
 *
 * Searching is answered here, on the extension host, because it is small and
 * every caller wants the answer at once. Building is not: the first build of
 * a workspace writes every note, and goes to a worker thread, which leaves
 * the host free while a new workspace fills its cache. An in-memory cache,
 * which a thread of its own could not see, is always built here.
 */
export class SearchStore implements vscode.Disposable {
  private readonly database: DatabaseSync;
  private readonly writer: SearchWriter;
  private readonly worker?: SearchWorkerClient;
  /**
   * What the cache holds, or is about to: the database's own record of it,
   * kept up to date as writes are issued.
   *
   * A scan handed to the worker is not in the database yet, and a scan that
   * followed it would otherwise compare against a cache without it and write
   * every note again — worse, it would not know which notes the first scan
   * had already removed. Read once and maintained here, the record is of
   * what has been asked for rather than what has landed.
   */
  private stored?: Map<string, StoredNote>;

  public constructor(storageUri: vscode.Uri | undefined) {
    const databasePath = storageUri
      ? join(storageUri.fsPath, 'deckard-search.sqlite')
      : ':memory:';
    this.database = openSearchDatabase(databasePath);
    this.writer = new SearchWriter(this.database);
    if (databasePath !== ':memory:') {
      // A thread that died may have taken batches with it, so what the cache
      // was told to hold is no longer known. Reading the database again is
      // the only way to find out what it really has.
      this.worker = new SearchWorkerClient(databasePath, () => {
        this.stored = undefined;
      });
    }
  }

  /**
   * Brings the cache in line with a full scan, so deletions cannot leave
   * stale hits.
   *
   * The database outlives the session, so a scan usually finds almost every
   * note as it was: only a note whose saved time or size differs is written
   * again, and a note the scan no longer finds is removed. Rewriting every
   * note took most of a second at 5,000 notes on each start and reindex.
   *
   * Comparing the scan against the cache happens here, because it reads only
   * a path, a time, and a size per note. The writing it asks for is what
   * goes to the worker, so a rescan that changed nothing sends nothing.
   */
  public replace(files: Iterable<ParsedFile>, parseFingerprint?: string): void {
    // The text index is rebuilt whole if it ever drifted from its entries, or
    // if the notes in it were parsed under settings that have since changed:
    // the files are the same, so nothing else would notice.
    const reparsed =
      parseFingerprint !== undefined &&
      this.writer.readParseFingerprint() !== parseFingerprint;
    const rebuild = this.writer.hasDrifted() || reparsed;
    if (reparsed) {
      this.stored = undefined;
      this.writer.writeParseFingerprint(parseFingerprint);
    }
    this.stored ??= this.writer.readStoredNotes();
    const changes = compareToStored(this.stored, files, rebuild);
    this.record(changes);
    const handedOver =
      changes.write.length >= WORKER_THRESHOLD &&
      this.worker?.send({
        write: changes.write,
        erase: changes.erase,
        clear: rebuild,
      }) === true;
    if (handedOver) {
      return;
    }
    this.writer.transaction(() => {
      if (rebuild) {
        this.writer.clear();
      }
      changes.write.forEach((note) => this.writer.writeNote(note));
      changes.erase.forEach((filePath) => this.writer.erase(filePath));
    });
  }

  /**
   * Synchronizes one saved file without waiting for a complete workspace scan.
   */
  public upsert(file: ParsedFile): void {
    const note = createNoteToWrite(file);
    this.stored?.set(note.filePath, {
      updatedAt: note.updatedAt,
      bytes: note.bytes,
    });
    this.writer.transaction(() => this.writer.writeNote(note));
  }

  public remove(filePath: string): void {
    this.stored?.delete(filePath);
    this.writer.transaction(() => this.writer.erase(filePath));
  }

  /**
   * Notes what a set of changes will have left in the cache once it is
   * written, wherever it is written.
   */
  private record(changes: CacheChanges): void {
    const stored = this.stored;
    if (!stored) {
      return;
    }
    if (changes.rebuild) {
      stored.clear();
    }
    changes.erase.forEach((filePath) => stored.delete(filePath));
    changes.write.forEach((note) =>
      stored.set(note.filePath, {
        updatedAt: note.updatedAt,
        bytes: note.bytes,
      }),
    );
  }

  /**
   * Resolves once every build handed to the worker has been written, so a
   * caller that has to read what it just wrote can wait for it.
   */
  public async whenIdle(): Promise<void> {
    await this.worker?.whenIdle();
  }

  /**
   * Finds the note sections, tasks, and front-matter-only files that contain
   * every word of a search, best first.
   *
   * Only normalized literal words reach the text index, so note text or a
   * search can never be read as full-text query syntax. When no entry has
   * every word, entries with any of them are returned and marked partial;
   * when nothing matches at all, a close spelling is suggested.
   */
  public searchEntries(
    query: string,
    options: EntrySearchOptions = {},
  ): EntrySearchResult {
    const terms = getSearchTerms(query);
    if (terms.length === 0) {
      return { matches: [], partial: false };
    }
    const limit = options.limit ?? 50;
    const prefixLastTerm = options.prefixLastTerm ?? true;
    const quoted = terms.map((term, index) =>
      prefixLastTerm && index === terms.length - 1 ? `"${term}"*` : `"${term}"`,
    );

    const matches = this.runSearch(quoted.join(' '), limit);
    if (matches.length > 0 || terms.length === 1) {
      return matches.length > 0
        ? { matches, partial: false }
        : { matches, partial: false, suggestion: this.suggest(query, terms) };
    }
    // A misspelled word is the usual reason no entry has every word, so the
    // correction is offered beside the partial matches too.
    const partialMatches = this.runSearch(quoted.join(' OR '), limit);
    return {
      matches: partialMatches,
      partial: partialMatches.length > 0,
      suggestion: this.suggest(query, terms),
    };
  }

  /**
   * Returns the files that match a search, best first, with the excerpt of
   * each file's best entry.
   */
  public search(query: string, limit = 50): StoredSearchMatch[] {
    const seen = new Set<string>();
    const results: StoredSearchMatch[] = [];
    for (const match of this.searchEntries(query, {
      limit: limit * 4,
      prefixLastTerm: false,
    }).matches) {
      if (seen.has(match.filePath)) {
        continue;
      }
      seen.add(match.filePath);
      results.push({ filePath: match.filePath, excerpt: match.excerpt });
      if (results.length >= limit) {
        break;
      }
    }
    return results;
  }

  public dispose(): void {
    this.worker?.dispose();
    this.database.close();
  }

  private runSearch(match: string, limit: number): EntrySearchMatch[] {
    const rows = this.database
      .prepare(
        `SELECT entries.kind AS kind,
                entries.entry_id AS id,
                notes.file_path AS filePath,
                entries.line AS line,
                bm25(entries_fts, ${COLUMN_WEIGHTS}) AS rank,
                snippet(entries_fts, -1, '', '', '…', 16) AS excerpt
         FROM entries_fts
         JOIN entries ON entries.id = entries_fts.rowid
         JOIN notes ON notes.id = entries.note_id
         WHERE entries_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(match, limit);
    return rows.map((row) => {
      const { kind, id, filePath, line, rank, excerpt } = row;
      if (
        (kind !== 'section' && kind !== 'task' && kind !== 'file') ||
        typeof id !== 'string' ||
        typeof filePath !== 'string' ||
        typeof excerpt !== 'string'
      ) {
        throw new Error('Deckard search index returned an invalid result.');
      }
      // bm25 is lower for a better match, so its negation reads the usual way.
      return {
        kind,
        id,
        filePath,
        line: Number(line),
        score: -Number(rank),
        excerpt,
      };
    });
  }

  /**
   * Answers, for each word the notes do not contain, the closest word they
   * do, preferring the most widely used. A word the notes already contain,
   * or one with no close neighbor, is left out, so an empty result means
   * there is nothing to correct.
   *
   * Every search surface corrects spelling through this one lookup, because
   * a correction is only as good as the words actually in the notes.
   */
  public suggestWords(terms: readonly string[]): Map<string, string> {
    const corrections = new Map<string, string>();
    if (terms.length === 0) {
      return corrections;
    }
    const lookup = this.database.prepare(
      `SELECT term, doc FROM entries_vocab
       WHERE term >= ? AND term < ?`,
    );
    const exists = this.database.prepare(
      'SELECT 1 AS found FROM entries_vocab WHERE term = ?',
    );
    for (const term of terms) {
      if (term.length < 3 || exists.get(term)) {
        continue;
      }
      const first = term[0];
      const allowed = term.length <= 4 ? 1 : 2;
      let best: { term: string; distance: number; docs: number } | undefined;
      for (const row of lookup.all(first, `${first}￿`)) {
        const candidate = String(row.term);
        if (Math.abs(candidate.length - term.length) > allowed) {
          continue;
        }
        const distance = editDistance(term, candidate, allowed);
        const docs = Number(row.doc);
        if (
          distance <= allowed &&
          (!best ||
            distance < best.distance ||
            (distance === best.distance && docs > best.docs))
        ) {
          best = { term: candidate, distance, docs };
        }
      }
      if (best) {
        corrections.set(term, best.term);
      }
    }
    return corrections;
  }

  /**
   * Rewrites a search with each misspelled word replaced by the closest word
   * the notes contain. Returns nothing when there is nothing to correct.
   */
  private suggest(query: string, terms: string[]): string | undefined {
    const corrections = this.suggestWords(terms);
    if (corrections.size === 0) {
      return undefined;
    }
    let suggestion = query;
    corrections.forEach((replacement, term) => {
      suggestion = replaceWord(suggestion, term, replacement);
    });
    return suggestion;
  }

}

/**
 * Lowercased words of a search, split the way the text index splits notes.
 */
export function getSearchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((term) => term.length > 1) ?? [],
    ),
  ];
}

/**
 * Levenshtein distance, giving up once it is certain to exceed `limit`.
 */
export function editDistance(left: string, right: string, limit: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowBest = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      );
      current.push(value);
      rowBest = Math.min(rowBest, value);
    }
    if (rowBest > limit) {
      return limit + 1;
    }
    previous = current;
  }
  return previous[right.length];
}

function replaceWord(text: string, word: string, replacement: string): string {
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
    'iu',
  );
  return text.replace(pattern, (_, before: string) => `${before}${replacement}`);
}
