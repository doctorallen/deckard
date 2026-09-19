import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';

import { ParsedFile, Section } from '../types';

/**
 * The full-text cache's database: its layout, and the writes that keep it in
 * step with the notes.
 *
 * This module knows nothing of VS Code, because the bulk of its writing is
 * done on a worker thread, where there is no VS Code to know about.
 */

/**
 * The cache's layout. A database from an older layout is dropped and rebuilt
 * from the next scan.
 */
const SCHEMA_VERSION = 2;

/**
 * How long a connection waits for another to finish writing before it gives
 * up. The worker writes a note at a time between commits, so a save that
 * lands mid-rebuild waits for a commit rather than a rebuild.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens the cache, creating it and its tables when they are not there yet.
 *
 * Every connection runs this, so a worker and the extension host each get a
 * usable database whichever of them opens it first.
 */
export function openSearchDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  const version = Number(
    database.prepare('PRAGMA user_version').get()?.user_version,
  );
  if (version !== SCHEMA_VERSION) {
    database.exec(`
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
  database.exec(`
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
  return database;
}

/** What a rescan compares a note against to tell whether it changed. */
export interface StoredNote {
  updatedAt: number | null;
  bytes: number;
}

/**
 * Everything a note needs to be written to the cache.
 *
 * A note arrives already split into the rows the text index ranks, because
 * splitting it costs about 3% of writing it: 4 ms against 155 ms at 940
 * notes. So the extension host splits, and the writing is what is worth
 * moving to a thread of its own — and the cache is never parsed twice, or
 * parsed a second way.
 */
export interface NoteToWrite {
  filePath: string;
  updatedAt: number | null;
  bytes: number;
  entries: SearchEntry[];
}

/** What a scan found, against what the cache already holds. */
export interface CacheChanges {
  write: NoteToWrite[];
  erase: string[];
  /** True when the cache drifted and has to be built again from nothing. */
  rebuild: boolean;
}

/**
 * Writes notes into the cache.
 *
 * Both the extension host and the worker write through this, so a note
 * written while a rebuild is running is written exactly as the rebuild would
 * have written it.
 */
export class SearchWriter {
  private readonly upsertNoteRow: StatementSync;
  private readonly findNoteId: StatementSync;
  private readonly deleteNote: StatementSync;
  private readonly writeEntry: StatementSync;
  private readonly writeEntryText: StatementSync;
  private readonly deleteEntryText: StatementSync;
  private readonly deleteEntries: StatementSync;

  public constructor(private readonly database: DatabaseSync) {
    this.upsertNoteRow = database.prepare(
      `INSERT INTO notes (file_path, updated_at, bytes)
       VALUES (?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         updated_at = excluded.updated_at,
         bytes = excluded.bytes`,
    );
    this.findNoteId = database.prepare(
      'SELECT id FROM notes WHERE file_path = ?',
    );
    this.deleteNote = database.prepare(
      'DELETE FROM notes WHERE file_path = ?',
    );
    this.writeEntry = database.prepare(
      'INSERT INTO entries (note_id, kind, entry_id, line) VALUES (?, ?, ?, ?)',
    );
    this.writeEntryText = database.prepare(
      `INSERT INTO entries_fts (rowid, title, headings, tags, body)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.deleteEntryText = database.prepare(
      `DELETE FROM entries_fts
       WHERE rowid IN (SELECT id FROM entries WHERE note_id = ?)`,
    );
    this.deleteEntries = database.prepare(
      'DELETE FROM entries WHERE note_id = ?',
    );
  }

  /** Everything the cache holds about each note it has seen. */
  public readStoredNotes(): Map<string, StoredNote> {
    const stored = new Map<string, StoredNote>();
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
    return stored;
  }

  /** True when the text index has drifted from the entries it indexes. */
  public hasDrifted(): boolean {
    return (
      this.count('SELECT count(*) AS count FROM entries_fts') !==
      this.count('SELECT count(*) AS count FROM entries')
    );
  }

  public clear(): void {
    this.database.exec(
      'DELETE FROM notes; DELETE FROM entries; DELETE FROM entries_fts;',
    );
  }

  /**
   * Commits a change's statements together, so a note is never left without
   * its text and a save commits once rather than once per entry.
   */
  public transaction(change: () => void): void {
    this.database.exec('BEGIN');
    try {
      change();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** Writes a parsed note, splitting it into its rows first. */
  public write(file: ParsedFile): void {
    this.writeNote(createNoteToWrite(file));
  }

  /** Writes a note already split into the rows the text index ranks. */
  public writeNote(note: NoteToWrite): void {
    // An update keeps the note's id, so its old entries are found and
    // replaced.
    this.upsertNoteRow.run(note.filePath, note.updatedAt, note.bytes);
    const noteId = Number(this.findNoteId.get(note.filePath)?.id);
    this.deleteEntryText.run(noteId);
    this.deleteEntries.run(noteId);
    for (const entry of note.entries) {
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

  public erase(filePath: string): void {
    const row = this.findNoteId.get(filePath);
    if (row) {
      // The text goes first: it is found through the note's entries.
      this.deleteEntryText.run(Number(row.id));
      this.deleteEntries.run(Number(row.id));
    }
    this.deleteNote.run(filePath);
  }

  private count(sql: string): number {
    return Number(this.database.prepare(sql).get()?.count);
  }
}

/**
 * What a scan changes about the cache: the notes whose saved time or size
 * differ, and the notes the scan no longer finds.
 *
 * The comparison is what makes a rescan cheap, and it is cheap itself: it
 * reads a path, a time, and a size per note, never a note's text. It runs
 * wherever `replace` is called, and only the writing it asks for is worth
 * moving to a thread of its own.
 */
export function compareToStored(
  stored: ReadonlyMap<string, StoredNote>,
  files: Iterable<ParsedFile>,
  rebuild: boolean,
): CacheChanges {
  const changes: CacheChanges = { write: [], erase: [], rebuild };
  const scanned = new Set<string>();
  for (const file of files) {
    scanned.add(file.filePath);
    const previous = rebuild ? undefined : stored.get(file.filePath);
    const unchanged =
      previous !== undefined &&
      file.fileTimes?.updatedAt !== undefined &&
      previous.updatedAt === file.fileTimes.updatedAt &&
      previous.bytes === Buffer.byteLength(file.content, 'utf8');
    if (!unchanged) {
      changes.write.push(createNoteToWrite(file));
    }
  }
  if (!rebuild) {
    for (const filePath of stored.keys()) {
      if (!scanned.has(filePath)) {
        changes.erase.push(filePath);
      }
    }
  }
  return changes;
}

/** Splits a parsed note into what the cache stores about it. */
export function createNoteToWrite(file: ParsedFile): NoteToWrite {
  return {
    filePath: file.filePath,
    updatedAt: file.fileTimes?.updatedAt ?? null,
    bytes: Buffer.byteLength(file.content, 'utf8'),
    entries: createSearchEntries(file),
  };
}

export interface SearchEntry {
  kind: 'section' | 'task' | 'file';
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
    // The section's own text: a parent's row no longer repeats every word of
    // its children, which used to make one sentence match four entries.
    body: section.bodyContent ?? section.rawContent,
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
