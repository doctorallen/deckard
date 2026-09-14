import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';

import * as vscode from 'vscode';

import { ParsedFile } from '../types';

export interface StoredSearchMatch {
  filePath: string;
  excerpt: string;
}

/**
 * Maintains a private, workspace-scoped full-text index. The database is a
 * cache: Markdown files remain the source of truth and are reindexed at start.
 */
export class SearchStore implements vscode.Disposable {
  private readonly database: DatabaseSync;
  private readonly writeNote: StatementSync;
  private readonly deleteNote: StatementSync;
  private readonly writeText: StatementSync;
  private readonly deleteText: StatementSync;

  public constructor(storageUri: vscode.Uri | undefined) {
    const databasePath = storageUri
      ? join(storageUri.fsPath, 'deckard-search.sqlite')
      : ':memory:';
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS notes (
        file_path TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER
      ) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        file_path UNINDEXED,
        content
      );
    `);
    this.writeNote = this.database.prepare(
      `INSERT INTO notes (file_path, content, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         content = excluded.content,
         updated_at = excluded.updated_at`,
    );
    this.deleteNote = this.database.prepare(
      'DELETE FROM notes WHERE file_path = ?',
    );
    this.writeText = this.database.prepare(
      'INSERT INTO notes_fts (file_path, content) VALUES (?, ?)',
    );
    this.deleteText = this.database.prepare(
      'DELETE FROM notes_fts WHERE file_path = ?',
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
        `SELECT file_path AS filePath, updated_at AS updatedAt,
                length(CAST(content AS BLOB)) AS bytes
         FROM notes`,
      )
      .all()) {
      stored.set(String(row.filePath), {
        updatedAt: row.updatedAt === null ? null : Number(row.updatedAt),
        bytes: Number(row.bytes),
      });
    }
    // The text index is rebuilt whole if it ever drifted from the notes.
    const indexedCount = Number(
      this.database.prepare('SELECT count(*) AS count FROM notes_fts').get()
        ?.count,
    );

    this.database.exec('BEGIN');
    try {
      if (indexedCount !== stored.size) {
        this.database.exec('DELETE FROM notes; DELETE FROM notes_fts;');
        stored.clear();
      }
      const scanned = new Set<string>();
      for (const file of files) {
        scanned.add(file.filePath);
        const previous = stored.get(file.filePath);
        const unchanged =
          previous !== undefined &&
          file.updatedAt !== undefined &&
          previous.updatedAt === file.updatedAt &&
          previous.bytes === Buffer.byteLength(file.content, 'utf8');
        if (!unchanged) {
          this.write(file);
        }
      }
      for (const filePath of stored.keys()) {
        if (!scanned.has(filePath)) {
          this.remove(filePath);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Synchronizes one saved file without waiting for a complete workspace scan.
   */
  public upsert(file: ParsedFile): void {
    this.write(file);
  }

  public remove(filePath: string): void {
    this.deleteNote.run(filePath);
    this.deleteText.run(filePath);
  }

  /**
   * Searches only normalized literal tokens, preventing note text from being
   * interpreted as FTS query syntax.
   */
  public search(query: string, limit = 50): StoredSearchMatch[] {
    const terms = getSearchTerms(query);
    if (terms.length === 0) {
      return [];
    }

    const match = terms.map((term) => `"${term}"`).join(' OR ');
    const rows = this.database
      .prepare(
        `SELECT file_path AS filePath,
                snippet(notes_fts, 1, '', '', '...', 18) AS excerpt
         FROM notes_fts
         WHERE notes_fts MATCH ?
         LIMIT ?`,
      )
      .all(match, limit);
    return rows.map((row) => {
      const filePath = row.filePath;
      const excerpt = row.excerpt;
      if (typeof filePath !== 'string' || typeof excerpt !== 'string') {
        throw new Error('Deckard search index returned an invalid result.');
      }
      return { filePath, excerpt };
    });
  }

  public dispose(): void {
    this.database.close();
  }

  private write(file: ParsedFile): void {
    this.writeNote.run(file.filePath, file.content, file.updatedAt ?? null);
    this.deleteText.run(file.filePath);
    this.writeText.run(file.filePath, file.content);
  }
}

function getSearchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]*/g)
        ?.filter((term) => term.length > 1) ?? [],
    ),
  ];
}
