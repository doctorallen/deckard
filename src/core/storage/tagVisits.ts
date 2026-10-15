/**
 * Since you last looked (docs/implementation/37-since-you-last-looked.md):
 * what each tag's page held when the reader last had it open, one snapshot
 * a tag, kept in VS Code's storage for the workspace. Never in the notes,
 * and never in the preferences blob that is copied machine-wide and backed
 * up: a snapshot names the workspace's entries, and there is no history of
 * them, only the last visit, replaced each time a visit counts.
 *
 * Each snapshot is a file of its own in the workspace's storage folder,
 * `tag-visits/<hash>.json`, read when a page or the Hubs view asks for it:
 * a person's page can hold some 50 KB of keys, and VS Code writes the whole
 * of `workspaceState` again at every change, so 500 of them there would
 * make every write megabytes. Only a list of every tag's visit time is kept
 * in `workspaceState`, which says which to drop past the cap, oldest first,
 * and which the Hubs view reads. A window with no folder open has no
 * storage folder, and keeps the times without the snapshots. The Hubs
 * view's sort is kept here too, with the workspace whose hubs it sorts.
 */
import { Emitter } from '../../shared/emitter';
import { isRecord } from '../../shared/guards';
import { shortHash } from '../../shared/text';
import type { Event } from '../../ports/events';
import type { FileSystem } from '../../ports/fileSystem';
import type { KeyValueStore } from '../../ports/keyValueStore';
import type { ResourceUri } from '../../ports/uri';

/** What one tag's page held at the reader's last visit. */
export interface TagVisit {
  /** When the visit counted, in milliseconds since the epoch. */
  seenAt: number;
  /** Each note entry the page listed, by a key that outlasts its line moving, with a hash of its text. */
  entries: Record<string, string>;
  /** The page's tasks, by a key that outlasts a line moving or a done date written: those open, and those done. */
  tasks: { open: string[]; done: string[] };
  /** The hub's own fields and reverses, by name, each as its values read. */
  fields: Record<string, string>;
  /** The page's questions that were answered, by a key that outlasts a line moving; a visit before questions has none. */
  answered?: string[];
  /**
   * Whether the keys tell apart a note's entries, tasks, or questions with
   * the same words, by which of them each is; a visit kept before they did
   * has none.
   */
  ordinals?: true;
}

/** How the Hubs view orders each level: by name, or the hubs with the most new since their last visit first. */
export type HubSort = 'name' | 'new';

/** The list of every tag's visit time, by tag key. */
export const TAG_VISITS_KEY = 'deckard.tagVisits';
/**
 * The prefix each tag's snapshot was kept under in `workspaceState` before
 * the snapshots moved to files; `dropStoredSnapshots` removes them.
 */
export const TAG_VISIT_PREFIX = 'deckard.tagVisit:';
/** The folder in the workspace's storage the snapshots are kept in. */
export const TAG_VISIT_FOLDER = 'tag-visits';
/** The Hubs view's sort. */
export const HUB_SORT_KEY = 'deckard.hubs.sort';
/** The most snapshots kept; past it, the oldest visits go first. */
export const TAG_VISIT_LIMIT = 500;

/** Where the snapshots are kept: the workspace's storage folder, and the file system it is read through. */
export interface TagVisitFiles<U extends ResourceUri = ResourceUri> {
  /** `context.storageUri`; undefined in a window with no folder open. */
  storageUri: U | undefined;
  fileSystem: Pick<FileSystem<U>, 'joinPath' | 'readFile' | 'writeFile' | 'createDirectory' | 'delete' | 'rename'>;
}

/** A snapshot's file: the tag it is the visit to, since two tags' hashes may meet, and the visit. */
interface VisitFile {
  tag: string;
  visit: TagVisit;
}

/**
 * The tags' visits: the times in the workspace's store, each snapshot in
 * a file. A value written by hand, or by a later Deckard, that is not a
 * visit reads as no visit at all, as does a file that cannot be read.
 */
export class TagVisits<U extends ResourceUri = ResourceUri> {
  private readonly changeEmitter = new Emitter<void>();
  /** Fires when a visit is counted, or the Hubs view's sort changes, so the views that show them redraw. */
  public readonly onDidChange: Event<void> = this.changeEmitter.event;
  /** The visits being written, one after another, so one never reads the list before another has written it. */
  private writing: Promise<void> = Promise.resolve();

  private readonly folder: U | undefined;

  /** Over the workspace's store, with the snapshots in `files`; without them, the times alone. */
  public constructor(
    private readonly store: KeyValueStore,
    private readonly files?: TagVisitFiles<U>,
  ) {
    this.folder = files?.storageUri ? files.fileSystem.joinPath(files.storageUri, TAG_VISIT_FOLDER) : undefined;
  }

  /** The last visit to a tag's page, read from its file, or undefined when there is none to read. */
  public async get(tagKey: string): Promise<TagVisit | undefined> {
    const uri = this.fileOf(tagKey);
    if (!uri || !this.files) {
      return undefined;
    }
    try {
      const read: unknown = JSON.parse(new TextDecoder().decode(await this.files.fileSystem.readFile(uri)));
      return isRecord(read) && read.tag === tagKey ? readTagVisit(read.visit) : undefined;
    } catch {
      return undefined;
    }
  }

  /** When each tag's page was last seen, by tag key. */
  public seenAt(): ReadonlyMap<string, number> {
    const list = this.store.get<unknown>(TAG_VISITS_KEY);
    if (!isRecord(list)) {
      return new Map();
    }
    return new Map(Object.entries(list).filter((entry): entry is [string, number] => isTime(entry[1])));
  }

  /**
   * Counts a visit: replaces the tag's snapshot with this one. Tags `exists`
   * says are gone lose theirs, and past the cap the oldest visits go. Two
   * visits counted at once are written in turn, so neither's time is lost.
   */
  public record(tagKey: string, visit: TagVisit, exists: (tagKey: string) => boolean = () => true): Promise<void> {
    const written = this.writing.then(() => this.write(tagKey, visit, exists));
    this.writing = written.catch(() => undefined);
    return written;
  }

  /** Writes one visit, and the list of every tag's visit time with it. */
  private async write(tagKey: string, visit: TagVisit, exists: (tagKey: string) => boolean): Promise<void> {
    const times = new Map(this.seenAt());
    times.delete(tagKey);
    const kept = [...times.entries()]
      .filter(([key]) => exists(key))
      .sort((left, right) => right[1] - left[1])
      .slice(0, TAG_VISIT_LIMIT - 1);
    const keptKeys = new Set(kept.map(([key]) => key));
    const dropped = [...times.keys()].filter((key) => !keptKeys.has(key));
    await this.writeFile(tagKey, visit);
    for (const key of dropped) {
      await this.deleteFile(key);
    }
    await this.store.update(TAG_VISITS_KEY, Object.fromEntries([[tagKey, visit.seenAt], ...kept]));
    this.changeEmitter.fire();
  }

  /** A tag's snapshot file, or undefined with no storage folder. */
  private fileOf(tagKey: string): U | undefined {
    return this.folder && this.files ? this.files.fileSystem.joinPath(this.folder, `${shortHash(tagKey)}.json`) : undefined;
  }

  /**
   * Writes a tag's snapshot whole: beside its file first, then moved over
   * it, so a reader never finds half of one. A snapshot that cannot be
   * written is left out; the visit's time is still kept.
   */
  private async writeFile(tagKey: string, visit: TagVisit): Promise<void> {
    const uri = this.fileOf(tagKey);
    if (!uri || !this.folder || !this.files) {
      return;
    }
    const { fileSystem } = this.files;
    const written: VisitFile = { tag: tagKey, visit };
    const beside = fileSystem.joinPath(this.folder, `${shortHash(tagKey)}.json.tmp`);
    try {
      await fileSystem.createDirectory(this.folder);
      await fileSystem.writeFile(beside, new TextEncoder().encode(JSON.stringify(written)));
      await fileSystem.rename(beside, uri);
    } catch {
      // The band and the Hubs view read a missing snapshot as no visit.
    }
  }

  /** Deletes a tag's snapshot, when there is one. */
  private async deleteFile(tagKey: string): Promise<void> {
    const uri = this.fileOf(tagKey);
    if (!uri || !this.files) {
      return;
    }
    try {
      await this.files.fileSystem.delete(uri);
    } catch {
      // Already gone.
    }
  }

  /**
   * Removes the snapshots kept in `workspaceState` before they moved to
   * files, which VS Code would otherwise write again at every change. The
   * times stay; a page visited before reads as one never compared. Any
   * that cannot be removed now are tried again at the next start.
   */
  public async dropStoredSnapshots(): Promise<void> {
    try {
      for (const tagKey of this.seenAt().keys()) {
        if (this.store.get<unknown>(`${TAG_VISIT_PREFIX}${tagKey}`) !== undefined) {
          await this.store.update(`${TAG_VISIT_PREFIX}${tagKey}`, undefined);
        }
      }
    } catch {
      // Left for the next start.
    }
  }

  /** The Hubs view's sort: by name until the reader chooses What's new. */
  public hubSort(): HubSort {
    return this.store.get<unknown>(HUB_SORT_KEY) === 'new' ? 'new' : 'name';
  }

  /** Keeps the Hubs view's sort; by name is kept as nothing. */
  public async setHubSort(sort: HubSort): Promise<void> {
    await this.store.update(HUB_SORT_KEY, sort === 'new' ? 'new' : undefined);
    this.changeEmitter.fire();
  }

  /** Stops telling listeners; what was stored stays. */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** A time a visit could have counted at: a whole number of milliseconds from the epoch. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Whether a value is a list of text. */
function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Whether a value is a record of text by text. */
function isTextRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** A stored value read as a visit, or undefined when it is not one. */
export function readTagVisit(value: unknown): TagVisit | undefined {
  if (!isRecord(value) || !isTime(value.seenAt) || !isTextRecord(value.entries) || !isTextRecord(value.fields)) {
    return undefined;
  }
  const tasks = value.tasks;
  if (!isRecord(tasks) || !isTextList(tasks.open) || !isTextList(tasks.done)) {
    return undefined;
  }
  return {
    seenAt: value.seenAt,
    entries: { ...value.entries },
    tasks: { open: [...tasks.open], done: [...tasks.done] },
    fields: { ...value.fields },
    ...(isTextList(value.answered) ? { answered: [...value.answered] } : {}),
    ...(value.ordinals === true ? { ordinals: true as const } : {}),
  };
}
