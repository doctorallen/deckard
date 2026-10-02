import type { Disposable, Event } from '../../ports/events';
import { FileSystem, FileType } from '../../ports/fileSystem';
import type { ResourceUri } from '../../ports/uri';
import { PersistedPreferences } from '../types';

/** How many copies are kept; the oldest past this many are deleted after each write. */
export const SNAPSHOTS_KEPT = 20;
/** Long enough to fold a burst of changes into one copy. */
const SETTLE_MS = 2000;

/** One copy on disk. */
export interface PreferenceSnapshot<U extends ResourceUri = ResourceUri> {
  uri: U;
  /** When it was written, from its name. */
  at: Date;
}

/** The remembered state to copy, and the event that says it changed. */
interface SnapshotSource {
  readonly value: PersistedPreferences;
  readonly onDidChange: Event<PersistedPreferences>;
}

/**
 * A rolling set of copies of what a workspace remembers, written into that
 * workspace's storage every time it changes.
 *
 * Deckard once had a bug that emptied favorites, pins and view counts, and
 * the only reason the data came back is that someone could reconstruct it.
 * A store that is never copied is a store that one bad write can end. These
 * copies are what `Deckard: Restore Favorites, Pins, and Searches` offers.
 *
 * A window with no folder open has no storage of its own, and nothing to
 * remember about a workspace, so it writes nothing.
 */
export class PreferenceSnapshots<U extends ResourceUri = ResourceUri> implements Disposable {
  private readonly folder: U | undefined;
  private readonly disposables: Disposable[] = [];
  private pending: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  /**
   * Copies `source` into `preference-snapshots` under `storageUri`, the
   * workspace's storage folder, reading and writing through `fileSystem`;
   * with no storage folder, it writes and lists nothing.
   */
  public constructor(
    storageUri: U | undefined,
    private readonly source: SnapshotSource,
    private readonly fileSystem: FileSystem<U>,
  ) {
    this.folder = storageUri
      ? fileSystem.joinPath(storageUri, 'preference-snapshots')
      : undefined;
    if (this.folder) {
      this.disposables.push(source.onDidChange(() => this.schedule()));
    }
  }

  /** Every copy there is, newest first. */
  public async list(): Promise<Array<PreferenceSnapshot<U>>> {
    const folder = this.folder;
    if (!folder) {
      return [];
    }
    let entries: Array<[string, number]>;
    try {
      entries = await this.fileSystem.readDirectory(folder);
    } catch {
      return [];
    }
    return entries
      .filter(([name, type]) => type === FileType.File && /\.json$/.test(name))
      .map(([name]) => ({
        uri: this.fileSystem.joinPath(folder, name),
        at: dateFromName(name),
      }))
      .filter((snapshot) => !Number.isNaN(snapshot.at.getTime()))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /** Reads one copy back. Throws if it is not what Deckard wrote. */
  public async read(snapshot: PreferenceSnapshot<U>): Promise<unknown> {
    const bytes = await this.fileSystem.readFile(snapshot.uri);
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

  /** Stops listening and drops a copy still waiting to settle; a write already started finishes. */
  public dispose(): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Restarts the settle timer, so a burst of changes is written once. */
  private schedule(): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    this.pending = setTimeout(() => {
      this.pending = undefined;
      void this.write();
    }, SETTLE_MS);
  }

  /** Writes one copy and deletes those past SNAPSHOTS_KEPT; nothing without a storage folder. */
  private async write(): Promise<void> {
    const folder = this.folder;
    if (!folder) {
      return;
    }
    const job = async (): Promise<void> => {
      await this.fileSystem.createDirectory(folder);
      const name = `${nameFromDate(new Date())}.json`;
      const body = JSON.stringify(this.source.value, null, 2);
      await this.fileSystem.writeFile(
        this.fileSystem.joinPath(folder, name),
        Buffer.from(body, 'utf8'),
      );
      const all = await this.list();
      for (const old of all.slice(SNAPSHOTS_KEPT)) {
        await this.fileSystem.delete(old.uri);
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

/**
 * The time a copy was written, read back from a nameFromDate name. A name it
 * cannot read gives an Invalid Date, which list() drops.
 */
export function dateFromName(name: string): Date {
  const stem = name.replace(/\.json$/, '');
  const iso = stem.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  return new Date(iso);
}
