import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  }

  /**
   * Replaces the cache after a full scan so deletions cannot leave stale hits.
   */
  public replace(files: Iterable<ParsedFile>): void {
    const insertNote = this.database.prepare(
      'INSERT INTO notes (file_path, content, updated_at) VALUES (?, ?, ?)',
    );
    const insertFts = this.database.prepare(
      'INSERT INTO notes_fts (file_path, content) VALUES (?, ?)',
    );

    this.database.exec('BEGIN');
    try {
      this.database.exec('DELETE FROM notes; DELETE FROM notes_fts;');
      for (const file of files) {
        insertNote.run(file.filePath, file.content, file.updatedAt ?? null);
        insertFts.run(file.filePath, file.content);
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
    this.database
      .prepare(
        `INSERT INTO notes (file_path, content, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           content = excluded.content,
           updated_at = excluded.updated_at`,
      )
      .run(file.filePath, file.content, file.updatedAt ?? null);
    this.database.prepare('DELETE FROM notes_fts WHERE file_path = ?').run(
      file.filePath,
    );
    this.database
      .prepare('INSERT INTO notes_fts (file_path, content) VALUES (?, ?)')
      .run(file.filePath, file.content);
  }

  public remove(filePath: string): void {
    this.database.prepare('DELETE FROM notes WHERE file_path = ?').run(filePath);
    this.database
      .prepare('DELETE FROM notes_fts WHERE file_path = ?')
      .run(filePath);
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
