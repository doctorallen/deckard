import * as vscode from 'vscode';

import { PersistedPreferences } from '../types';

/**
 * A rolling set of copies of what a workspace remembers, written into that
 * workspace's storage every time it changes.
 *
 * Deckard once had a bug that emptied favourites, pins and view counts, and
 * the only reason the data came back is that someone could reconstruct it.
 * A store that is never copied is a store that one bad write can end. These
 * copies are what `Deckard: Restore Favourites, Pins, and Searches` offers.
 *
 * A window with no folder open has no storage of its own, and nothing to
 * remember about a workspace, so it writes nothing.
 */

export const SNAPSHOTS_KEPT = 20;
/** Long enough to fold a burst of changes into one copy. */
const SETTLE_MS = 2000;

export interface PreferenceSnapshot {
  uri: vscode.Uri;
  /** When it was written, from its name. */
  at: Date;
}

interface SnapshotSource {
  readonly value: PersistedPreferences;
  readonly onDidChange: vscode.Event<PersistedPreferences>;
}

export class PreferenceSnapshots implements vscode.Disposable {
  private readonly folder: vscode.Uri | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private pending: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  public constructor(
    storageUri: vscode.Uri | undefined,
    private readonly source: SnapshotSource,
  ) {
    this.folder = storageUri
      ? vscode.Uri.joinPath(storageUri, 'preference-snapshots')
      : undefined;
    if (this.folder) {
      this.disposables.push(source.onDidChange(() => this.schedule()));
    }
  }

  /** Every copy there is, newest first. */
  public async list(): Promise<PreferenceSnapshot[]> {
    if (!this.folder) {
      return [];
    }
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this.folder);
    } catch {
      return [];
    }
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && /\.json$/.test(name))
      .map(([name]) => ({
        uri: vscode.Uri.joinPath(this.folder as vscode.Uri, name),
        at: dateFromName(name),
      }))
      .filter((snapshot) => !Number.isNaN(snapshot.at.getTime()))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /** Reads one copy back. Throws if it is not what Deckard wrote. */
  public async read(snapshot: PreferenceSnapshot): Promise<unknown> {
    const bytes = await vscode.workspace.fs.readFile(snapshot.uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  }

  /** Writes a copy now, without waiting for the settle time. */
  public async writeNow(): Promise<void> {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = undefined;
    }
    await this.write();
    await this.writing;
  }

  public dispose(): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private schedule(): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    this.pending = setTimeout(() => {
      this.pending = undefined;
      void this.write();
    }, SETTLE_MS);
  }

  private async write(): Promise<void> {
    const folder = this.folder;
    if (!folder) {
      return;
    }
    const job = async (): Promise<void> => {
      await vscode.workspace.fs.createDirectory(folder);
      const name = `${nameFromDate(new Date())}.json`;
      const body = JSON.stringify(this.source.value, null, 2);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folder, name),
        Buffer.from(body, 'utf8'),
      );
      const all = await this.list();
      for (const old of all.slice(SNAPSHOTS_KEPT)) {
        await vscode.workspace.fs.delete(old.uri);
      }
    };
    // One write at a time, so a burst cannot interleave its directory reads
    // and delete a copy another write has only just made.
    this.writing = this.writing.then(job, job);
    await this.writing;
  }
}

/** `2026-09-22T19-43-14-277Z`: a name that sorts by time and is a legal file name. */
export function nameFromDate(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function dateFromName(name: string): Date {
  const stem = name.replace(/\.json$/, '');
  const iso = stem.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  return new Date(iso);
}
