import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';

import * as vscode from 'vscode';

import { ParsedFile, Section } from '../types';

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
 * The cache's layout. A database from an older layout is dropped and rebuilt
 * from the next scan.
 */
const SCHEMA_VERSION = 2;

/**
 * Relevance weights for the title, headings, tags, and body columns, in that
 * order. A word in a title says far more about an entry than the same word
 * somewhere in its body, as Omnisearch weights file names and headings.
 */
const COLUMN_WEIGHTS = '10.0, 4.0, 6.0, 1.0';

/**
 * Maintains a private, workspace-scoped full-text index. The database is a
 * cache: Markdown files remain the source of truth and are reindexed at start.
 *
 * Each note section, task, and front-matter-only file is its own row, so a
 * search ranks the entry that matched rather than the whole file around it.
 */
export class SearchStore implements vscode.Disposable {
  private readonly database: DatabaseSync;
  private readonly writeNote: StatementSync;
  private readonly findNoteId: StatementSync;
  private readonly deleteNote: StatementSync;
  private readonly writeEntry: StatementSync;
  private readonly writeEntryText: StatementSync;
  private readonly deleteEntryText: StatementSync;
  private readonly deleteEntries: StatementSync;

  public constructor(storageUri: vscode.Uri | undefined) {
    const databasePath = storageUri
      ? join(storageUri.fsPath, 'deckard-search.sqlite')
      : ':memory:';
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    const version = Number(
      this.database.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version !== SCHEMA_VERSION) {
      this.database.exec(`
        DROP TABLE IF EXISTS entries_vocab;
        DROP TABLE IF EXISTS entries_fts;
        DROP TABLE IF EXISTS entries;
        DROP TABLE IF EXISTS notes_fts;
        DROP TABLE IF EXISTS notes;
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    }
    // A note row records only what tells a rescan whether the note changed.
    // Its entries are found through the note's id, which is indexed, because
    // the text index cannot look rows up by an unindexed column cheaply.
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        updated_at INTEGER,
        bytes INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY,
        note_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        line INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS entries_note ON entries (note_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        title,
        headings,
        tags,
        body,
        prefix = '2 3',
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_vocab
        USING fts5vocab(entries_fts, 'row');
    `);
    this.writeNote = this.database.prepare(
      `INSERT INTO notes (file_path, updated_at, bytes)
       VALUES (?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         updated_at = excluded.updated_at,
         bytes = excluded.bytes`,
    );
    this.findNoteId = this.database.prepare(
      'SELECT id FROM notes WHERE file_path = ?',
    );
    this.deleteNote = this.database.prepare(
      'DELETE FROM notes WHERE file_path = ?',
    );
    this.writeEntry = this.database.prepare(
      'INSERT INTO entries (note_id, kind, entry_id, line) VALUES (?, ?, ?, ?)',
    );
    this.writeEntryText = this.database.prepare(
      `INSERT INTO entries_fts (rowid, title, headings, tags, body)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.deleteEntryText = this.database.prepare(
      `DELETE FROM entries_fts
       WHERE rowid IN (SELECT id FROM entries WHERE note_id = ?)`,
    );
    this.deleteEntries = this.database.prepare(
      'DELETE FROM entries WHERE note_id = ?',
    );
  }

  /**
   * Brings the cache in line with a full scan, so deletions cannot leave stale
   * hits.
   *
   * The database outlives the session, so a scan usually finds almost every
   * note as it was: only a note whose saved time or size differs is written
   * again, and a note the scan no longer finds is removed. Rewriting every
   * note took most of a second at 5,000 notes on each start and reindex.
   */
  public replace(files: Iterable<ParsedFile>): void {
    const stored = new Map<string, { updatedAt: number | null; bytes: number }>();
    for (const row of this.database
      .prepare(
        'SELECT file_path AS filePath, updated_at AS updatedAt, bytes FROM notes',
      )
      .all()) {
      stored.set(String(row.filePath), {
        updatedAt: row.updatedAt === null ? null : Number(row.updatedAt),
        bytes: Number(row.bytes),
      });
    }
    // The text index is rebuilt whole if it ever drifted from its entries.
    const entryCount = this.count('SELECT count(*) AS count FROM entries');
    const indexedCount = this.count('SELECT count(*) AS count FROM entries_fts');

    this.transaction(() => {
      if (indexedCount !== entryCount) {
        this.database.exec(
          'DELETE FROM notes; DELETE FROM entries; DELETE FROM entries_fts;',
        );
        stored.clear();
      }
      const scanned = new Set<string>();
      for (const file of files) {
        scanned.add(file.filePath);
        const previous = stored.get(file.filePath);
        const unchanged =
          previous !== undefined &&
          file.fileTimes?.updatedAt !== undefined &&
          previous.updatedAt === file.fileTimes.updatedAt &&
          previous.bytes === Buffer.byteLength(file.content, 'utf8');
        if (!unchanged) {
          this.write(file);
        }
      }
      for (const filePath of stored.keys()) {
        if (!scanned.has(filePath)) {
          this.erase(filePath);
        }
      }
    });
  }

  /**
   * Synchronizes one saved file without waiting for a complete workspace scan.
   */
  public upsert(file: ParsedFile): void {
    this.transaction(() => this.write(file));
  }

  public remove(filePath: string): void {
    this.transaction(() => this.erase(filePath));
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
   * Replaces each word the notes do not contain with the closest word they
   * do, preferring the most widely used. Returns nothing when every word is
   * already in the notes or none has a close neighbour.
   */
  private suggest(query: string, terms: string[]): string | undefined {
    const lookup = this.database.prepare(
      `SELECT term, doc FROM entries_vocab
       WHERE term >= ? AND term < ?`,
    );
    const exists = this.database.prepare(
      'SELECT 1 AS found FROM entries_vocab WHERE term = ?',
    );
    let suggestion = query;
    let changed = false;
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
        suggestion = replaceWord(suggestion, term, best.term);
        changed = true;
      }
    }
    return changed ? suggestion : undefined;
  }

  private count(sql: string): number {
    return Number(this.database.prepare(sql).get()?.count);
  }

  /**
   * Commits a change's statements together, so a note is never left without
   * its text and a save commits once rather than once per entry.
   */
  private transaction(change: () => void): void {
    this.database.exec('BEGIN');
    try {
      change();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private write(file: ParsedFile): void {
    // An update keeps the note's id, so its old entries are found and
    // replaced.
    this.writeNote.run(
      file.filePath,
      file.fileTimes?.updatedAt ?? null,
      Buffer.byteLength(file.content, 'utf8'),
    );
    const noteId = Number(this.findNoteId.get(file.filePath)?.id);
    this.deleteEntryText.run(noteId);
    this.deleteEntries.run(noteId);
    for (const entry of createSearchEntries(file)) {
      const entryRowId = this.writeEntry.run(
        noteId,
        entry.kind,
        entry.id,
        entry.line,
      ).lastInsertRowid;
      this.writeEntryText.run(
        entryRowId,
        entry.title,
        entry.headings,
        entry.tags,
        entry.body,
      );
    }
  }

  private erase(filePath: string): void {
    const row = this.findNoteId.get(filePath);
    if (row) {
      // The text goes first: it is found through the note's entries.
      this.deleteEntryText.run(Number(row.id));
      this.deleteEntries.run(Number(row.id));
    }
    this.deleteNote.run(filePath);
  }
}

interface SearchEntry {
  kind: EntrySearchMatch['kind'];
  id: string;
  line: number;
  title: string;
  headings: string;
  tags: string;
  body: string;
}

/**
 * Splits a parsed note into the rows the text index ranks.
 *
 * The headings column carries the file name and every heading above an
 * entry, so a search for a project finds the check-in filed beneath its
 * heading, and a search for a date finds that day's note.
 */
export function createSearchEntries(file: ParsedFile): SearchEntry[] {
  const fileName = (file.filePath.split('/').pop() ?? file.filePath).replace(
    /\.md$/i,
    '',
  );
  const sections = new Map(file.sections.map((section) => [section.id, section]));
  const headingPath = (sectionId: string | undefined): string[] => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current = sectionId ? sections.get(sectionId) : undefined;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current.heading);
      current = current.parentSectionId
        ? sections.get(current.parentSectionId)
        : undefined;
    }
    return path;
  };
  const tagText = (keys: readonly string[], labels: Record<string, string>) =>
    keys.map((key) => labels[key] ?? key).join(' ');

  const entries: SearchEntry[] = file.sections.map((section: Section) => ({
    kind: 'section',
    id: section.id,
    line: section.startLine,
    title: section.heading,
    headings: [fileName, ...headingPath(section.parentSectionId)].join(' / '),
    tags: tagText(section.tags, section.tagLabels),
    body: section.rawContent,
  }));
  file.tasks.forEach((task) => {
    entries.push({
      kind: 'task',
      id: task.id,
      line: task.lineNumber,
      title: task.title,
      headings: [fileName, ...headingPath(task.sectionId)].join(' / '),
      tags: tagText(task.tags, task.tagLabels),
      body: '',
    });
  });
  if (file.sections.length === 0) {
    entries.push({
      kind: 'file',
      id: file.filePath,
      line: 1,
      title: fileName,
      headings: '',
      tags: file.frontmatterTags.map((tag) => tag.label).join(' '),
      body: file.content,
    });
  }
  return entries;
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
