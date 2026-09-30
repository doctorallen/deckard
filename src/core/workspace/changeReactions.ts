/**
 * What the index does about each change to the workspace, written as data.
 *
 * The indexer used to decide this in its listeners, as a run of booleans and
 * nested ifs. Here the decision is one pure function over a description of
 * the change, so a test can pin every row without VS Code, and the
 * `ChangeWatcher` only delivers changes and carries out the answer.
 */

/**
 * One change to the workspace, as far as the index cares: a settings change
 * (answering which settings it touched), the set of workspace folders, a
 * saved document, or a file watcher's create, change, or delete.
 *
 * `isNote` is whether the file is a note: the watchers' globs take in files
 * that are not notes, such as templates, and a save can be of any document.
 * A delete carries no `isNote`, since a removal of a path the index does not
 * hold changes nothing.
 */
export type WorkspaceChange =
  | { readonly kind: 'settings'; readonly affects: (section: string) => boolean }
  | { readonly kind: 'folders' }
  | { readonly kind: 'save'; readonly isNote: boolean }
  | { readonly kind: 'created' | 'changed'; readonly isNote: boolean }
  | { readonly kind: 'deleted' };

/**
 * What a change requires, carried out in this order: forget the parked
 * rules, republish with parking worked out again, replace the watchers,
 * rescan, then queue the file.
 */
export interface Reactions {
  /** Forget the `deckard.parked` rules read, so the next index reads them again. */
  readonly forgetParkedRules: boolean;
  /**
   * Derive the index again and publish it, with no reads, once a first
   * scan has built it: parking is a setting, not part of any note.
   */
  readonly republishParking: boolean;
  /** Replace the file watchers, since the globs they watch changed. */
  readonly rewatch: boolean;
  /**
   * Scan the workspace again. A note whose stat is unchanged is reused,
   * unless the parse fingerprint changed, when every note is reparsed.
   */
  readonly rescan: boolean;
  /** Queue the file to be read again, or removed, after the debounce. */
  readonly queue: 'upsert' | 'delete' | undefined;
  /**
   * Whether a note Deckard just saved itself skips the debounce, so the
   * board and the other writers see their own change at once.
   */
  readonly ownWriteSkipsDebounce: boolean;
}

/** What a settings row adds to the reactions; what it leaves out stays off. */
type SettingEffects = Partial<Pick<Reactions, 'forgetParkedRules' | 'republishParking' | 'rewatch' | 'rescan'>>;

/** One row of the settings table: the settings it names, and what a change to any of them does. */
export interface SettingRow extends SettingEffects {
  readonly settings: readonly string[];
}

/**
 * The settings the index reacts to, and how. A change that touches several
 * rows does what each of them does. A setting named in no row changes
 * nothing the index holds.
 */
export const SETTING_ROWS: readonly SettingRow[] = [
  // Parking is worked out on the derived index, so a change to it needs no
  // read. Before a first scan there is nothing to redraw.
  { settings: ['deckard.parked'], forgetParkedRules: true, republishParking: true },
  // Parked tags are keyed through the aliases, as the index keys them. The
  // aliases are a parse setting too, so the rescan reparses every note.
  { settings: ['deckard.entityNamespaceAliases'], forgetParkedRules: true, rescan: true },
  // The watchers' globs are built from the notes folder.
  { settings: ['deckard.notesFolder'], rewatch: true, rescan: true },
  // Parse settings: each is in the parse fingerprint, so the rescan
  // reparses every note rather than reusing any.
  { settings: ['deckard.parseInlineTags', 'deckard.noteBoundaries', 'deckard.personMarker'], rescan: true },
  // Which files are notes: the rescan reuses each note whose stat is unchanged.
  { settings: ['deckard.templatesFolder', 'deckard.exclude', 'files.exclude', 'search.exclude'], rescan: true },
];

/** Reactions that do nothing, which each kind of change adds to. */
const NOTHING: Reactions = {
  forgetParkedRules: false,
  republishParking: false,
  rewatch: false,
  rescan: false,
  queue: undefined,
  ownWriteSkipsDebounce: false,
};

/**
 * What the index does about one change to the workspace. Pure: it reads only
 * the change, so the same change always gets the same answer.
 */
export function reactionsTo(change: WorkspaceChange): Reactions {
  switch (change.kind) {
    case 'settings':
      return settingReactions(change.affects);
    case 'folders':
      // Each folder has its own watchers, and parked folders are relative to
      // the folder that holds them.
      return { ...NOTHING, forgetParkedRules: true, rewatch: true, rescan: true };
    case 'save':
      return change.isNote ? { ...NOTHING, queue: 'upsert', ownWriteSkipsDebounce: true } : NOTHING;
    case 'created':
    case 'changed':
      return change.isNote ? { ...NOTHING, queue: 'upsert' } : NOTHING;
    case 'deleted':
      return { ...NOTHING, queue: 'delete' };
  }
}

/** Every row a settings change touches, joined: a reaction is on when any row turns it on. */
function settingReactions(affects: (section: string) => boolean): Reactions {
  return SETTING_ROWS
    .filter((row) => row.settings.some((setting) => affects(setting)))
    .reduce<Reactions>(
      (reactions, row) => ({
        ...reactions,
        forgetParkedRules: reactions.forgetParkedRules || (row.forgetParkedRules ?? false),
        republishParking: reactions.republishParking || (row.republishParking ?? false),
        rewatch: reactions.rewatch || (row.rewatch ?? false),
        rescan: reactions.rescan || (row.rescan ?? false),
      }),
      NOTHING,
    );
}
