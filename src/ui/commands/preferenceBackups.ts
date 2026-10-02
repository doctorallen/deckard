import * as path from 'path';

import * as vscode from 'vscode';

import { PreferenceSnapshots } from '../../core/storage/preferenceSnapshots';
import { normalizePreferences } from '../../core/storage/preferencesSchema';
import { isRecord } from '../../shared/guards';
import { pluralize } from '../../shared/text';
import { reportFailure } from './notify';
import { PersistedPreferences } from '../../domain/model';

/**
 * Taking what a workspace remembers out, and putting it back.
 *
 * Export writes it as one JSON file wherever the reader chooses; Import
 * reads one back. Restore offers the copies Deckard has been keeping on
 * its own. Each of the last two replaces what this workspace remembers, so
 * each says what it is about to do, from when, and asks.
 */

/** A file that reads, but is not one Deckard wrote. */
export class NotPreferencesError extends Error {
  /** The message is what Import shows the reader; the default suits any file that is not an export. */
  constructor(message = 'This is not a Deckard preferences file.') {
    super(message);
    this.name = 'NotPreferencesError';
  }
}

/** What an exported file holds, so a file that is not one is turned away. */
export interface PreferenceExport {
  deckard: {
    kind: 'preferences';
    version: 1;
    exportedAt: string;
  };
  preferences: PersistedPreferences;
}

/** What export, import, and restore read, and what replaces the blob whole. */
interface BackupStore {
  reader: { readonly value: PersistedPreferences };
  maintenance: { importPreferences(value: PersistedPreferences): Promise<void> };
}

/** Wraps the blob with the marker readExport looks for, stamped with when it was taken. */
export function createExport(
  preferences: PersistedPreferences,
  now = new Date(),
): PreferenceExport {
  return {
    deckard: { kind: 'preferences', version: 1, exportedAt: now.toISOString() },
    preferences,
  };
}

/**
 * Reads an export, or a snapshot, back. A snapshot is the bare preference
 * blob; an export wraps it. Anything else is refused with a reason.
 *
 * What it returns is normalized, as every blob the repository keeps is: a
 * file written by hand, or by an older Deckard, can leave a list out, and
 * describing it before the confirm would otherwise read a list that is not
 * there.
 */
export function readExport(value: unknown): {
  preferences: PersistedPreferences;
  exportedAt?: Date;
} {
  if (!isRecord(value)) {
    throw new NotPreferencesError();
  }
  if (isRecord(value.deckard)) {
    if (value.deckard.kind !== 'preferences' || !isRecord(value.preferences)) {
      throw new NotPreferencesError('This Deckard file does not hold preferences.');
    }
    const exportedAt =
      typeof value.deckard.exportedAt === 'string'
        ? new Date(value.deckard.exportedAt)
        : undefined;
    return {
      preferences: normalizePreferences(value.preferences as Partial<PersistedPreferences>),
      exportedAt,
    };
  }
  if (value.version === 1 && Array.isArray(value.favoriteTags)) {
    return { preferences: normalizePreferences(value as Partial<PersistedPreferences>) };
  }
  throw new NotPreferencesError();
}

/** One line saying what a blob holds, for a reader to weigh before replacing. */
export function describePreferences(preferences: PersistedPreferences): string {
  const parts = [
    pluralize(preferences.favoriteTags.length, 'favorite tag', 'favorite tags', { emptyForZero: true }),
    pluralize(preferences.favoriteEntities.length, 'favorite entity', 'favorite entities', { emptyForZero: true }),
    pluralize((preferences.pinnedNotes ?? []).length, 'pinned note', 'pinned notes', { emptyForZero: true }),
    pluralize(preferences.savedFilters.length, 'saved search', 'saved searches', { emptyForZero: true }),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nothing chosen yet';
}

/**
 * Asks where to save, through the save dialog, and writes this workspace's
 * preferences there as one JSON file. Cancelling the dialog writes nothing.
 */
export async function exportPreferences(store: BackupStore): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('deckard-preferences.json'),
    filters: { JSON: ['json'] },
    title: 'Export what Deckard remembers about this workspace',
  });
  if (!target) {
    return;
  }
  const body = JSON.stringify(createExport(store.reader.value), null, 2);
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  void vscode.window.showInformationMessage(
    `Exported ${describePreferences(store.reader.value)} to ${target.fsPath}.`,
  );
}

/**
 * Asks for a file, through the open dialog, and replaces this workspace's
 * preferences with it once the reader confirms, after `snapshots` keeps a
 * copy of what is there now. A file that is not an export or a snapshot is
 * turned away, and nothing changes.
 */
export async function importPreferences(
  store: BackupStore,
  snapshots: PreferenceSnapshots,
): Promise<void> {
  const chosen = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { JSON: ['json'] },
    title: 'Import what Deckard should remember about this workspace',
  });
  const source = chosen?.[0];
  if (!source) {
    return;
  }
  let parsed: ReturnType<typeof readExport>;
  try {
    const bytes = await vscode.workspace.fs.readFile(source);
    parsed = readExport(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch (error) {
    const fileName = path.basename(source.path);
    void reportFailure(
      error instanceof NotPreferencesError
        ? { outcome: `${fileName} is not a Deckard preferences file, so nothing was imported.` }
        : { outcome: `Deckard could not read ${fileName}, so nothing was imported.`, error },
    );
    return;
  }
  await replaceAfterAsking(store, snapshots, parsed.preferences, {
    what: `the file ${source.fsPath}`,
    when: parsed.exportedAt,
  });
}

/**
 * Lists the copies Deckard kept, newest first, and replaces this workspace's
 * preferences with the one chosen once the reader confirms. With no copies
 * yet it says when one will be written.
 */
export async function restorePreferences(
  store: BackupStore,
  snapshots: PreferenceSnapshots,
): Promise<void> {
  const all = await snapshots.list();
  if (all.length === 0) {
    void vscode.window.showInformationMessage(
      'Deckard has no copies of this workspace’s preferences yet. It writes one a moment after each change.',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    all.map((snapshot) => ({
      label: snapshot.at.toLocaleString(),
      description: describeAge(snapshot.at),
      snapshot,
    })),
    { title: 'Restore what Deckard remembered, from when?', placeHolder: 'Newest first' },
  );
  if (!picked) {
    return;
  }
  let preferences: PersistedPreferences;
  try {
    preferences = readExport(await snapshots.read(picked.snapshot)).preferences;
  } catch (error) {
    void reportFailure({
      outcome: 'Deckard could not read that copy, so nothing was restored.',
      error,
    });
    return;
  }
  await replaceAfterAsking(store, snapshots, preferences, {
    what: 'the copy Deckard kept',
    when: picked.snapshot.at,
  });
}

/**
 * Asks, in a modal, before replacing: it names both what comes in and what
 * goes, since what goes is only recoverable from the copy taken first.
 *
 * The copy is written here, once the reader confirms, rather than left to
 * the copy each change schedules: preferences chosen in an earlier session
 * have no copy until something changes in this one, and a copy that cannot
 * be written stops the replace, since the modal promised one.
 */
async function replaceAfterAsking(
  store: BackupStore,
  snapshots: PreferenceSnapshots,
  preferences: PersistedPreferences,
  from: { what: string; when?: Date },
): Promise<void> {
  const when = from.when ? ` from ${from.when.toLocaleString()}` : '';
  const now = describePreferences(store.reader.value);
  const confirm = await vscode.window.showWarningMessage(
    `Replace what this workspace remembers with ${from.what}${when}?`,
    {
      modal: true,
      detail: snapshots.keepsCopies
        ? `It holds ${describePreferences(preferences)}. What is here now holds ${now}, and is copied first so it can be restored.`
        : `It holds ${describePreferences(preferences)}. What is here now holds ${now}. With no folder open, Deckard keeps no copy of it, so it cannot be restored.`,
    },
    'Replace',
  );
  if (confirm !== 'Replace') {
    return;
  }
  try {
    await snapshots.writeNow();
  } catch (error) {
    void reportFailure({
      outcome: 'Deckard could not keep a copy of what this workspace remembers, so nothing was replaced.',
      fix: 'Check that the disk has space and can be written to, then try again.',
      error,
    });
    return;
  }
  await store.maintenance.importPreferences(preferences);
  void vscode.window.showInformationMessage(
    `Restored ${describePreferences(preferences)}.`,
  );
}

/** How long ago a copy was taken, rounded to the unit a reader would say. */
function describeAge(at: Date, now = Date.now()): string {
  const minutes = Math.round((now - at.getTime()) / 60000);
  if (minutes < 1) {return 'just now';}
  if (minutes < 60) {return `${minutes} min ago`;}
  const hours = Math.round(minutes / 60);
  if (hours < 48) {return `${hours} h ago`;}
  return `${Math.round(hours / 24)} days ago`;
}

