import * as vscode from 'vscode';

import {
  PreferenceSnapshot,
  PreferenceSnapshots,
} from '../../core/storage/preferenceSnapshots';
import { PersistedPreferences } from '../../core/types';

/**
 * Taking what a workspace remembers out, and putting it back.
 *
 * Export writes it as one JSON file wherever the reader chooses; Import
 * reads one back. Restore offers the copies Deckard has been keeping on
 * its own. Each of the last two replaces what this workspace remembers, so
 * each says what it is about to do, from when, and asks.
 */

/** What an exported file holds, so a file that is not one is turned away. */
export interface PreferenceExport {
  deckard: {
    kind: 'preferences';
    version: 1;
    exportedAt: string;
  };
  preferences: PersistedPreferences;
}

interface BackupStore {
  readonly value: PersistedPreferences;
  importPreferences(value: PersistedPreferences): Promise<void>;
}

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
 */
export function readExport(value: unknown): {
  preferences: PersistedPreferences;
  exportedAt?: Date;
} {
  if (!isRecord(value)) {
    throw new Error('This is not a Deckard preferences file.');
  }
  if (isRecord(value.deckard)) {
    if (value.deckard.kind !== 'preferences' || !isRecord(value.preferences)) {
      throw new Error('This Deckard file does not hold preferences.');
    }
    const exportedAt =
      typeof value.deckard.exportedAt === 'string'
        ? new Date(value.deckard.exportedAt)
        : undefined;
    return {
      preferences: value.preferences as unknown as PersistedPreferences,
      exportedAt,
    };
  }
  if (value.version === 1 && Array.isArray(value.favoriteTags)) {
    return { preferences: value as unknown as PersistedPreferences };
  }
  throw new Error('This is not a Deckard preferences file.');
}

/** One line saying what a blob holds, for a reader to weigh before replacing. */
export function describePreferences(preferences: PersistedPreferences): string {
  const parts = [
    count(preferences.favoriteTags.length, 'favourite tag'),
    count(preferences.favoriteEntities.length, 'favourite entity', 'favourite entities'),
    count((preferences.pinnedNotes ?? []).length, 'pinned note'),
    count(preferences.savedFilters.length, 'saved search', 'saved searches'),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nothing chosen yet';
}

export async function exportPreferences(store: BackupStore): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('deckard-preferences.json'),
    filters: { JSON: ['json'] },
    title: 'Export what Deckard remembers about this workspace',
  });
  if (!target) {
    return;
  }
  const body = JSON.stringify(createExport(store.value), null, 2);
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  void vscode.window.showInformationMessage(
    `Exported ${describePreferences(store.value)} to ${target.fsPath}.`,
  );
}

export async function importPreferences(store: BackupStore): Promise<void> {
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
    void vscode.window.showErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  await replaceAfterAsking(store, parsed.preferences, {
    what: `the file ${source.fsPath}`,
    when: parsed.exportedAt,
  });
}

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
    void vscode.window.showErrorMessage(
      `That copy could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  await replaceAfterAsking(store, preferences, {
    what: 'the copy Deckard kept',
    when: picked.snapshot.at,
  });
}

async function replaceAfterAsking(
  store: BackupStore,
  preferences: PersistedPreferences,
  from: { what: string; when?: Date },
): Promise<void> {
  const when = from.when ? ` from ${from.when.toLocaleString()}` : '';
  const confirm = await vscode.window.showWarningMessage(
    `Replace what this workspace remembers with ${from.what}${when}?`,
    {
      modal: true,
      detail: `It holds ${describePreferences(preferences)}. What is here now holds ${describePreferences(store.value)}, and is copied first so it can be restored.`,
    },
    'Replace',
  );
  if (confirm !== 'Replace') {
    return;
  }
  await store.importPreferences(preferences);
  void vscode.window.showInformationMessage(
    `Restored ${describePreferences(preferences)}.`,
  );
}

function count(n: number, one: string, many = `${one}s`): string {
  return n === 0 ? '' : `${n} ${n === 1 ? one : many}`;
}

function describeAge(at: Date, now = Date.now()): string {
  const minutes = Math.round((now - at.getTime()) / 60000);
  if (minutes < 1) {return 'just now';}
  if (minutes < 60) {return `${minutes} min ago`;}
  const hours = Math.round(minutes / 60);
  if (hours < 48) {return `${hours} h ago`;}
  return `${Math.round(hours / 24)} days ago`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { PreferenceSnapshot };
