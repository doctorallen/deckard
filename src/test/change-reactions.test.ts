import * as assert from 'assert';

import { Reactions, reactionsTo, WorkspaceChange } from '../core/workspace/changeReactions';

/**
 * A settings change touching `changed`, answering as VS Code's
 * `affectsConfiguration` does: a section is touched when it or anything
 * under it changed.
 */
function settings(...changed: string[]): WorkspaceChange {
  return {
    kind: 'settings',
    affects: (section) => changed.some((key) => key === section || key.startsWith(`${section}.`)),
  };
}

const NOTHING: Reactions = {
  forgetParkedRules: false,
  republishParking: false,
  rewatch: false,
  rescan: false,
  queue: undefined,
  ownWriteSkipsDebounce: false,
};
const RESCAN: Reactions = { ...NOTHING, rescan: true };

/** One row of the table as the indexer's listeners decided it before it was data. */
const ROWS: Array<[string, WorkspaceChange, Reactions]> = [
  ['deckard.parked forgets the parked rules and republishes, with no rescan',
    settings('deckard.parked'), { ...NOTHING, forgetParkedRules: true, republishParking: true }],
  ['a setting under deckard.parked counts as deckard.parked',
    settings('deckard.parked.tags'), { ...NOTHING, forgetParkedRules: true, republishParking: true }],
  ['deckard.entityNamespaceAliases forgets the parked rules and rescans, with no republish',
    settings('deckard.entityNamespaceAliases'), { ...NOTHING, forgetParkedRules: true, rescan: true }],
  ['deckard.notesFolder replaces the watchers and rescans',
    settings('deckard.notesFolder'), { ...NOTHING, rewatch: true, rescan: true }],
  ['deckard.parseInlineTags rescans', settings('deckard.parseInlineTags'), RESCAN],
  ['deckard.noteBoundaries rescans', settings('deckard.noteBoundaries'), RESCAN],
  ['deckard.personMarker rescans', settings('deckard.personMarker'), RESCAN],
  ['deckard.templatesFolder rescans', settings('deckard.templatesFolder'), RESCAN],
  ['deckard.exclude rescans', settings('deckard.exclude'), RESCAN],
  ['files.exclude rescans', settings('files.exclude'), RESCAN],
  ['search.exclude rescans', settings('search.exclude'), RESCAN],
  ['a setting the index does not read does nothing', settings('deckard.dashboard.widgets', 'editor.fontSize'), NOTHING],
  ['a change to several rows does what each does',
    settings('deckard.parked', 'deckard.notesFolder'),
    { ...NOTHING, forgetParkedRules: true, republishParking: true, rewatch: true, rescan: true }],
  ['a change of workspace folders forgets the parked rules, replaces the watchers, and rescans',
    { kind: 'folders' }, { ...NOTHING, forgetParkedRules: true, rewatch: true, rescan: true }],
  ['saving a note queues it, and a save of Deckard\'s own skips the debounce',
    { kind: 'save', isNote: true }, { ...NOTHING, queue: 'upsert', ownWriteSkipsDebounce: true }],
  ['saving a file that is not a note does nothing', { kind: 'save', isNote: false }, NOTHING],
  ['a note the watcher sees created is queued, debounced',
    { kind: 'created', isNote: true }, { ...NOTHING, queue: 'upsert' }],
  ['a note the watcher sees changed is queued, debounced',
    { kind: 'changed', isNote: true }, { ...NOTHING, queue: 'upsert' }],
  ['a file the watcher sees created that is not a note does nothing', { kind: 'created', isNote: false }, NOTHING],
  ['a file the watcher sees changed that is not a note does nothing', { kind: 'changed', isNote: false }, NOTHING],
  ['a deleted file is queued for removal, note or not', { kind: 'deleted' }, { ...NOTHING, queue: 'delete' }],
];

suite('What each change to the workspace requires', () => {
  ROWS.forEach(([name, change, expected]) => {
    test(name, () => {
      assert.deepStrictEqual(reactionsTo(change), expected);
    });
  });
});
