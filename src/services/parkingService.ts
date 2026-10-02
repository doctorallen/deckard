import { createExcludeMatcher } from '../core/workspace/scanner';
import { findWrittenKey, planKeyRemoval, readExcludeKey, relativeExcludeKey, withExcludeKey } from '../domain/index/excludeKeys';
import { ParkedRules, toParkedTagKey } from '../domain/index/parked';
import { countNotesIn, parkedTagSettingValue, parkingFolder, parkingTags } from '../domain/index/parkingRules';
import { resolveIndexedTagKey } from '../domain/index/tagNavigation';
import { addFrontmatterTag, readFrontmatterTagValues, removeFrontmatterTags } from '../domain/markdown/frontmatterTags';
import type { WorkspaceIndex } from '../domain/model';
import { countTagMatches } from '../domain/query/queryEvaluator';
import type { Configuration } from '../ports/configuration';
import type { ResourceUri, WorkspaceFolder } from '../ports/uri';

/**
 * Park Note, Park Folder, and Park Tag, and their Unpark counterparts: which
 * notes, folders, and tags can be parked or unparked, why the others cannot,
 * and the writes that do it.
 *
 * A parked note stays indexed and searchable, and is left out of the lists
 * of things to do. Park Note writes the first parked tag into the note's
 * front matter rather than moving the file: a tag travels with the note, and
 * a move would break every link and tool that knows its path. Folders and
 * tags are parked in `deckard.parked.folders` and `deckard.parked.tags`.
 *
 * Every outcome comes back as a result the command words. A result that
 * waits on the reader, such as a note parked by a tag Deckard did not write,
 * carries the step that follows their answer, so nothing is decided twice.
 */

/** What the service reads of the index besides the snapshot it is handed. */
export interface ParkingIndex<U extends ResourceUri> {
  getFilePath(uri: U): string;
  isNotesFile(uri: U): boolean;
  getParkedRules(): ParkedRules;
}

/** The open workspace's folders, and which one holds a resource, as `vscode.workspace` has them. */
export interface ParkingWorkspace<U extends ResourceUri> {
  readonly workspaceFolders?: readonly WorkspaceFolder<U>[];
  getWorkspaceFolder(uri: U): WorkspaceFolder<U> | undefined;
}

/** One place a setting is written, and its value there alone. */
export interface SettingPlace {
  /** The value at that place, so a value set elsewhere is never copied in. */
  readonly current: unknown;
  /** Writes `value` there. False when it could not be saved, which the writer has already said. */
  write(value: unknown): Promise<boolean>;
}

/** Where a `deckard.*` setting is written for a resource. */
export interface ParkingSettings<U extends ResourceUri> {
  /**
   * Where the setting is already set most specifically; when nothing sets
   * it, the folder's own settings in a multi-root workspace and the
   * workspace's otherwise.
   */
  place(key: string, scope?: U): SettingPlace;
  /**
   * Every level the setting can be set at for `scope`, most specific
   * first: the folder's own settings in a multi-root workspace, the
   * workspace's, and the user's. An object such as `deckard.parked.folders`
   * is merged across them, a key's value coming from the most specific
   * level that holds it, so taking a key out has to find that level.
   */
  levels(key: string, scope: U): SettingPlace[];
}

/** What one Park Note or Unpark Note writes, which names it in the Undo prompt. */
export interface ParkingWriteLabel {
  action: 'parking' | 'unparking';
  notes: number;
}

/** Whether a write of the notes landed, and the handle its Undo works through. */
export type ParkingWriteOutcome<Handle> = { applied: false } | { applied: true; handle: Handle };

/**
 * One write to the notes, built up note by note: each note's text is read
 * once, replaced whole, and all of them written together.
 */
export interface ParkingEdit<U extends ResourceUri, Handle> {
  /** The note's text as it is now. */
  read(uri: U): Promise<string>;
  /** Replaces the whole of a note already read. */
  replace(uri: U, content: string): void;
  write(label: ParkingWriteLabel): Promise<ParkingWriteOutcome<Handle>>;
}

/** What ParkingService works through. */
export interface ParkingCollaborators<U extends ResourceUri, Handle> {
  index: ParkingIndex<U>;
  workspace: ParkingWorkspace<U>;
  /** The effective settings, for what excludes or parks a folder by pattern. */
  configuration: Configuration<U>;
  settings: ParkingSettings<U>;
  /** A new write, for each Park Note or Unpark Note. */
  edits: () => ParkingEdit<U, Handle>;
}

/**
 * What Park Note came to. Only `parked` wrote anything.
 *
 * The three single-note refusals are kept apart because each has its own
 * message: the note is not indexed, is parked by its folder (which the
 * reader may unpark), or is already parked. With several notes those notes
 * are passed over, and `all-parked` says none was left.
 */
export type ParkNotesResult<U extends ResourceUri, Handle> =
  | { kind: 'refused'; reason: 'no-parked-tag' }
  | { kind: 'refused'; reason: 'not-indexed'; uri: U }
  | { kind: 'refused'; reason: 'parked-by-folder'; filePath: string; folder: string }
  | { kind: 'refused'; reason: 'already-parked'; filePath: string }
  | { kind: 'refused'; reason: 'all-parked' }
  /** No note could be parked, and this is the first whose front matter could not be read. */
  | { kind: 'unreadable'; filePath: string; tag: string }
  | { kind: 'not-applied' }
  | { kind: 'parked'; filePaths: string[]; handle: Handle };

/** What Unpark Note came to once the reader has answered any question. */
export type UnparkNotesOutcome<Handle> =
  /** No note had a parked tag to take out. */
  | { kind: 'nothing' }
  | { kind: 'not-applied' }
  | { kind: 'unparked'; filePaths: string[]; handle: Handle };

/**
 * What Unpark Note came to. The refusals, `unreadable`, and `parked-by-tag`
 * come only for a single note; with several, such notes are passed over.
 * `parked-by-tag` is a note parked by a tag other than the one Park Note
 * writes, which says more than "parked": `removeTag()` takes it out of the
 * note once the reader asks for that.
 */
export type UnparkNotesResult<Handle> =
  | { kind: 'refused'; reason: 'parked-by-folder'; filePath: string; folder: string }
  | { kind: 'refused'; reason: 'not-parked'; filePath: string }
  | { kind: 'unreadable'; filePath: string }
  | {
      kind: 'parked-by-tag';
      filePath: string;
      tag: string;
      label: string;
      removeTag: () => Promise<UnparkNotesOutcome<Handle>>;
    }
  | UnparkNotesOutcome<Handle>;

/** What Park Folder came to once any question about the exclude setting is answered. */
export type ParkFolderOutcome =
  | { kind: 'not-written' }
  | { kind: 'refused'; reason: 'already-parked'; name: string }
  /** `undo()` writes back what `deckard.parked.folders` held before. */
  | { kind: 'parked'; name: string; notes: number; undo: () => Promise<boolean> };

/**
 * What Park Folder came to. `excluded` is a folder `deckard.exclude` leaves
 * out, which is not indexed and so cannot be parked; when the setting names
 * it by an exact key, `parkInstead()` takes it out of the setting and parks
 * it.
 */
export type ParkFolderResult =
  | { kind: 'refused'; reason: 'outside-workspace' }
  | { kind: 'excluded'; name: string; parkInstead?: () => Promise<ParkFolderOutcome> }
  | ParkFolderOutcome;

/**
 * What Unpark Folder came to. `parked-by-pattern` is a folder a glob parks,
 * which only the setting itself can change.
 */
export type UnparkFolderResult =
  | { kind: 'refused'; reason: 'outside-workspace' }
  | { kind: 'refused'; reason: 'not-parked'; name: string }
  | { kind: 'parked-by-pattern'; name: string; pattern: string }
  | { kind: 'not-written' }
  | { kind: 'unparked'; name: string; notes: number };

/**
 * What Park Tag came to. `parked-through` is a tag parked already because
 * its parent is.
 */
export type ParkTagResult =
  | { kind: 'refused'; reason: 'not-a-tag' }
  | { kind: 'refused'; reason: 'already-parked'; label: string }
  | { kind: 'parked-through'; label: string; parent: string }
  | { kind: 'not-written' }
  /** `undo()` writes back what `deckard.parked.tags` held before. */
  | { kind: 'parked'; label: string; notes: number; tasks: number; undo: () => Promise<boolean> };

/**
 * What Unpark Tag came to. `parked-through` is a tag parked by its parent;
 * `parked-elsewhere` is one parked by a setting at a place Deckard does not
 * write, such as the user's settings under a workspace value.
 */
export type UnparkTagResult =
  | { kind: 'refused'; reason: 'not-a-tag' }
  | { kind: 'refused'; reason: 'not-parked'; label: string }
  | { kind: 'parked-through'; label: string; parent: string }
  | { kind: 'parked-elsewhere'; label: string }
  | { kind: 'not-written' }
  | { kind: 'unparked'; label: string };

/** A folder as the parking settings name it. */
interface FolderPlace<U extends ResourceUri> {
  /** The escaped key the settings hold for it. */
  key: string;
  /** Its path from its workspace folder, as messages name it. */
  name: string;
  /** Its path as the index writes paths, with the folder's name in a multi-root workspace. */
  indexPath: string;
  root: WorkspaceFolder<U>;
}

/** One note Unpark Note is considering, and what it has gathered so far. */
interface UnparkNote<U extends ResourceUri, Handle> {
  index: WorkspaceIndex;
  rules: ParkedRules;
  uri: U;
  single: boolean;
  /** The tag Park Note writes, which is taken out without asking. */
  writtenTag: string | undefined;
  edit: ParkingEdit<U, Handle>;
}

/** A note passed over because several were chosen. */
const SKIP = { kind: 'skip' } as const;

/**
 * Parks and unparks notes, folders, and tags. One is made where the
 * extension starts; it holds nothing between commands.
 */
export class ParkingService<U extends ResourceUri, Handle> {
  /** Takes the index, the workspace, the settings, and the writes it works through. */
  public constructor(private readonly collaborators: ParkingCollaborators<U, Handle>) {}

  /** Park Note: writes the first parked tag into each note's front matter. */
  public async parkNotes(index: WorkspaceIndex, uris: readonly U[]): Promise<ParkNotesResult<U, Handle>> {
    const rules = this.collaborators.index.getParkedRules();
    const tag = rules.tags.find((candidate) => candidate.startsWith('#'));
    if (!tag) {
      return { kind: 'refused', reason: 'no-parked-tag' };
    }
    const edit = this.collaborators.edits();
    const parked: string[] = [];
    const unreadable: string[] = [];
    const single = uris.length === 1;
    for (const uri of uris) {
      const refusal = this.refusePark(index, rules, uri, single);
      if (refusal?.kind === 'skip') {
        continue;
      }
      if (refusal) {
        return refusal;
      }
      const filePath = this.collaborators.index.getFilePath(uri);
      const next = addFrontmatterTag(await edit.read(uri), tag.slice(1));
      if (next === undefined) {
        unreadable.push(filePath);
        continue;
      }
      edit.replace(uri, next);
      parked.push(filePath);
    }
    if (unreadable.length > 0 && parked.length === 0) {
      return { kind: 'unreadable', filePath: unreadable[0], tag: tag.slice(1) };
    }
    if (parked.length === 0) {
      return { kind: 'refused', reason: 'all-parked' };
    }
    const written = await edit.write({ action: 'parking', notes: parked.length });
    return written.applied ? { kind: 'parked', filePaths: parked, handle: written.handle } : { kind: 'not-applied' };
  }

  /** Unpark Note: takes the parked tags out of each note's front matter. */
  public async unparkNotes(index: WorkspaceIndex, uris: readonly U[]): Promise<UnparkNotesResult<Handle>> {
    const rules = this.collaborators.index.getParkedRules();
    // The tag Park Note writes, and any other written the same way, is taken
    // out without asking; another parked tag says more than "parked".
    const writtenTag = rules.tags.find((candidate) => candidate.startsWith('#'));
    const edit = this.collaborators.edits();
    const unparked: string[] = [];
    const single = uris.length === 1;
    for (const uri of uris) {
      const step = await this.assessUnpark({ index, rules, uri, single, writtenTag, edit });
      if (step.kind === 'skip') {
        continue;
      }
      if (step.kind !== 'remove') {
        return step;
      }
      if (await this.removeTags(edit, uri, step.tags)) {
        unparked.push(step.filePath);
      }
    }
    return this.writeUnparked(edit, unparked);
  }

  /** Park Folder: adds the folder to `deckard.parked.folders`. */
  public async parkFolder(index: WorkspaceIndex, uri: U): Promise<ParkFolderResult> {
    const place = this.folderPlace(uri);
    if (!place) {
      return { kind: 'refused', reason: 'outside-workspace' };
    }
    const excludeSetting = this.collaborators.configuration
      .getConfiguration('deckard', place.root.uri)
      .get<unknown>('exclude', {});
    if (!createExcludeMatcher(excludeSetting)(place.name)) {
      return this.parkPlace(index, place);
    }
    const exact = findWrittenKey(excludeSetting, place.name);
    return {
      kind: 'excluded',
      name: place.name,
      ...(exact ? { parkInstead: () => this.parkExcluded(index, place) } : {}),
    };
  }

  /** Unpark Folder: takes the folder's key out of `deckard.parked.folders`. */
  public async unparkFolder(index: WorkspaceIndex, uri: U): Promise<UnparkFolderResult> {
    const place = this.folderPlace(uri);
    if (!place) {
      return { kind: 'refused', reason: 'outside-workspace' };
    }
    const removal = this.planFolderKeyRemoval('parked.folders', place);
    if (!removal) {
      return this.whyNotUnparked(place);
    }
    if (!(await removal.target.write(removal.value))) {
      return { kind: 'not-written' };
    }
    return { kind: 'unparked', name: place.name, notes: countNotesIn(index, place.indexPath) };
  }

  /**
   * Park Tag: adds the tag to `deckard.parked.tags`. `requested` is a key,
   * or a tag as the reader wrote it, which need not be indexed yet.
   */
  public async parkTag(index: WorkspaceIndex, requested: string): Promise<ParkTagResult> {
    const key = resolveIndexedTagKey(index.tags, requested) ?? toParkedTagKey(requested);
    if (!key) {
      return { kind: 'refused', reason: 'not-a-tag' };
    }
    const label = index.tags.get(key)?.label ?? key;
    const rules = this.collaborators.index.getParkedRules();
    const lower = key.toLowerCase();
    if (rules.tags.includes(lower)) {
      return { kind: 'refused', reason: 'already-parked', label };
    }
    const parent = rules.tags.find((tag) => lower.startsWith(`${tag}/`));
    if (parent) {
      return { kind: 'parked-through', label, parent };
    }
    const place = this.collaborators.settings.place('parked.tags');
    const list = listOf(place.current);
    if (!(await place.write([...list, parkedTagSettingValue(key)]))) {
      return { kind: 'not-written' };
    }
    const count = countTagMatches(index).get(key) ?? { notes: 0, tasks: 0 };
    return { kind: 'parked', label, notes: count.notes, tasks: count.tasks, undo: () => place.write(place.current) };
  }

  /**
   * Unpark Tag: takes the tag out of `deckard.parked.tags`. `rules` are the
   * parked rules the tag was chosen from.
   */
  public async unparkTag(index: WorkspaceIndex, requested: string, rules: ParkedRules): Promise<UnparkTagResult> {
    const key = toParkedTagKey(requested);
    if (!key) {
      return { kind: 'refused', reason: 'not-a-tag' };
    }
    const label = index.tags.get(resolveIndexedTagKey(index.tags, key) ?? key)?.label ?? key;
    const place = this.collaborators.settings.place('parked.tags');
    const list = listOf(place.current);
    const kept = list.filter((value) => toParkedTagKey(value) !== key);
    if (kept.length === list.length) {
      return whyTagNotUnparked(rules, key, label);
    }
    if (!(await place.write(kept))) {
      return { kind: 'not-written' };
    }
    return { kind: 'unparked', label };
  }

  /**
   * Why one note of those chosen cannot be parked, when it cannot: a single
   * note is refused, and one of several is skipped. Undefined when it can.
   */
  private refusePark(
    index: WorkspaceIndex,
    rules: ParkedRules,
    uri: U,
    single: boolean,
  ): ParkNotesResult<U, Handle> | typeof SKIP | undefined {
    const filePath = this.collaborators.index.getFilePath(uri);
    if (!this.collaborators.index.isNotesFile(uri) || !index.files.has(filePath)) {
      return single ? { kind: 'refused', reason: 'not-indexed', uri } : SKIP;
    }
    const folder = parkingFolder(rules, filePath);
    if (folder && single) {
      return { kind: 'refused', reason: 'parked-by-folder', filePath, folder };
    }
    if (folder || parkingTags(index, rules, filePath).length > 0) {
      return single ? { kind: 'refused', reason: 'already-parked', filePath } : SKIP;
    }
    return undefined;
  }

  /**
   * What Unpark Note does with one note: refuses it (when it is the only
   * one), skips it, asks about a tag Park Note did not write, or takes out
   * the tags that park it.
   */
  private async assessUnpark(
    note: UnparkNote<U, Handle>,
  ): Promise<UnparkNotesResult<Handle> | typeof SKIP | { kind: 'remove'; filePath: string; tags: string[] }> {
    const { index, rules, uri, single, writtenTag, edit } = note;
    const filePath = this.collaborators.index.getFilePath(uri);
    const folder = parkingFolder(rules, filePath);
    if (folder) {
      return single ? { kind: 'refused', reason: 'parked-by-folder', filePath, folder } : SKIP;
    }
    const tags = parkingTags(index, rules, filePath);
    if (tags.length === 0) {
      return single ? { kind: 'refused', reason: 'not-parked', filePath } : SKIP;
    }
    if (readFrontmatterTagValues(await edit.read(uri)) === undefined) {
      return single ? { kind: 'unreadable', filePath } : SKIP;
    }
    const other = tags.find((key) => key !== writtenTag);
    if (other && !single) {
      return SKIP;
    }
    if (!other) {
      return { kind: 'remove', filePath, tags };
    }
    return {
      kind: 'parked-by-tag',
      filePath,
      tag: other,
      label: index.tags.get(other)?.label ?? other,
      removeTag: async () => this.writeUnparked(edit, (await this.removeTags(edit, uri, tags)) ? [filePath] : []),
    };
  }

  /**
   * Takes the tags out of the note's front matter as it reads now. False,
   * and nothing replaced, when its front matter can no longer be read.
   */
  private async removeTags(edit: ParkingEdit<U, Handle>, uri: U, tags: readonly string[]): Promise<boolean> {
    const next = removeFrontmatterTags(await edit.read(uri), tags);
    if (next === undefined) {
      return false;
    }
    edit.replace(uri, next);
    return true;
  }

  /** Writes what Unpark Note took out, when it took anything out. */
  private async writeUnparked(edit: ParkingEdit<U, Handle>, unparked: string[]): Promise<UnparkNotesOutcome<Handle>> {
    if (unparked.length === 0) {
      return { kind: 'nothing' };
    }
    const written = await edit.write({ action: 'unparking', notes: unparked.length });
    return written.applied ? { kind: 'unparked', filePaths: unparked, handle: written.handle } : { kind: 'not-applied' };
  }

  /** Takes a folder's exact key out of `deckard.exclude`, then parks it. */
  private async parkExcluded(index: WorkspaceIndex, place: FolderPlace<U>): Promise<ParkFolderOutcome> {
    // The key was found in the merged value, so some level holds it as true.
    const removal = this.planFolderKeyRemoval('exclude', place);
    if (!removal || !(await removal.target.write(removal.value))) {
      return { kind: 'not-written' };
    }
    return this.parkPlace(index, place);
  }

  /**
   * What takes a folder's key out of an object setting merged across
   * levels, wherever the key in force is set; undefined when no level
   * names the folder by a `true` key. Unpark Folder and Park Instead used
   * to look only at the most specific level that set anything, so a key
   * in the user's settings, beside a workspace that set others, stayed.
   */
  private planFolderKeyRemoval(key: 'exclude' | 'parked.folders', place: FolderPlace<U>) {
    const levels = this.collaborators.settings.levels(key, place.root.uri);
    return planKeyRemoval(
      levels.map((level) => ({ target: level, value: level.current })),
      place.name,
    );
  }

  /** Adds a folder the exclude setting does not leave out to `deckard.parked.folders`. */
  private async parkPlace(index: WorkspaceIndex, place: FolderPlace<U>): Promise<ParkFolderOutcome> {
    const parked = this.collaborators.settings.place('parked.folders', place.root.uri);
    if (this.collaborators.index.getParkedRules().isParkedPath(place.indexPath)) {
      return { kind: 'refused', reason: 'already-parked', name: place.name };
    }
    if (!(await parked.write(withExcludeKey(parked.current, place.key, true)))) {
      return { kind: 'not-written' };
    }
    return {
      kind: 'parked',
      name: place.name,
      notes: countNotesIn(index, place.indexPath),
      undo: () => parked.write(parked.current),
    };
  }

  /** Why a folder with no key of its own cannot be unparked: a pattern parks it, or nothing does. */
  private whyNotUnparked(place: FolderPlace<U>): UnparkFolderResult {
    const everywhere = this.collaborators.configuration
      .getConfiguration('deckard', place.root.uri)
      .get<Record<string, unknown>>('parked.folders', {});
    const pattern = Object.entries(everywhere).find(
      ([candidate, on]) => on === true && createExcludeMatcher({ [candidate]: true })(place.name),
    )?.[0];
    return pattern
      ? { kind: 'parked-by-pattern', name: place.name, pattern }
      : { kind: 'refused', reason: 'not-parked', name: place.name };
  }

  /**
   * A folder's key and index path: relative to its workspace folder, named
   * in a multi-root workspace. Undefined outside the workspace, and for a
   * workspace folder itself.
   */
  private folderPlace(uri: U): FolderPlace<U> | undefined {
    const root = this.collaborators.workspace.getWorkspaceFolder(uri);
    if (!root) {
      return undefined;
    }
    const key = relativeExcludeKey(uri.path.replace(/\/+$/, ''), root.uri.path.replace(/\/+$/, ''));
    if (key === undefined) {
      return undefined;
    }
    const name = readExcludeKey(key);
    const multiRoot = (this.collaborators.workspace.workspaceFolders?.length ?? 0) > 1;
    return { key, name, indexPath: multiRoot ? `${root.name}/${name}` : name, root };
  }
}

/** The strings a list setting holds; anything but a list holds none. */
function listOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Why a tag the setting does not list by name cannot be unparked here: its
 * parent parks it, a setting Deckard does not write parks it, or nothing does.
 */
function whyTagNotUnparked(rules: ParkedRules, key: string, label: string): UnparkTagResult {
  const parent = rules.tags.find((tag) => key.startsWith(`${tag}/`));
  if (parent) {
    return { kind: 'parked-through', label, parent };
  }
  if (rules.tags.includes(key)) {
    return { kind: 'parked-elsewhere', label };
  }
  return { kind: 'refused', reason: 'not-parked', label };
}
