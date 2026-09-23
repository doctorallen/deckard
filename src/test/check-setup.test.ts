import * as assert from 'assert';

import { buildSetupReport, SetupFacts } from '../ui/commands/checkSetup';

/** A workspace where everything is as it should be. */
const healthy = (): SetupFacts => ({
  folders: [{ name: 'notes', notesFolder: '', notesFolderExists: true, templatesFolder: 'templates', templatesFolderExists: true }],
  scan: { found: 51, templates: 3, excluded: 2, read: 51 },
  excludePatterns: ['**/archive'],
  unreadable: [],
  indexed: { files: 51, sections: 485, tasks: 104, tags: 185 },
  personMarker: '@',
  people: 12,
  me: '@ren-kade',
  meIsKnown: true,
  tasksForMe: 7,
});

suite('Setup check', () => {
  const at = new Date('2026-09-22T10:00:00Z');

  test('a healthy workspace reads as one, with nothing to do', () => {
    const report = buildSetupReport(healthy(), at);
    assert.match(report, /^# Deckard setup check/);
    assert.match(report, /✅ Notes are read from all of `notes`/);
    assert.match(report, /✅ 51 Markdown files found; 51 read/);
    assert.match(report, /ℹ️ 3 kept out as templates/);
    assert.match(report, /ℹ️ 2 of 51 kept out by exclude patterns \(`\*\*\/archive`\)/);
    assert.match(report, /✅ Every note that was found was read/);
    assert.match(report, /✅ 12 people known/);
    assert.match(report, /✅ `deckard.me` is `@ren-kade`, a person the index knows; 7 tasks are for you/);
    assert.doesNotMatch(report, /⚠️/, 'nothing to warn about');
  });

  test('a notes folder that does not exist is the first thing it says', () => {
    const report = buildSetupReport({
      ...healthy(),
      folders: [{ name: 'work', notesFolder: 'notes/journal', notesFolderExists: false }],
      scan: { found: 0, templates: 0, excluded: 0, read: 0 },
      indexed: { files: 0, sections: 0, tasks: 0, tags: 0 },
    }, at);
    assert.match(report, /⚠️ `deckard.notesFolder` is `notes\/journal`, but that folder does not exist in `work`, so nothing is indexed/);
    assert.match(report, /What to do:\*\* Fix the setting, or create the folder/);
  });

  test('an exclude pattern that swallows most notes is called out; a small one is only noted', () => {
    const wide = buildSetupReport({ ...healthy(), scan: { found: 40, templates: 0, excluded: 30, read: 10 }, excludePatterns: ['**/*.md'] }, at);
    assert.match(wide, /⚠️ 30 of 40 kept out by exclude patterns \(`\*\*\/\*\.md`\)\. That is 75%/);
    assert.match(wide, /one pattern may be wider than meant/);
    const narrow = buildSetupReport({ ...healthy(), scan: { found: 40, templates: 0, excluded: 3, read: 37 } }, at);
    assert.match(narrow, /ℹ️ 3 of 40 kept out/);
    assert.doesNotMatch(narrow, /wider than meant/);
  });

  test('unreadable notes are listed with their reasons and the way out', () => {
    const report = buildSetupReport({
      ...healthy(),
      unreadable: [{ filePath: 'notes/bad.md', reason: 'EACCES: permission denied' }],
    }, at);
    assert.match(report, /⚠️ 1 note could not be read, so it is not indexed:\n  - `notes\/bad.md` — EACCES: permission denied/);
    assert.match(report, /Deckard: Reindex Workspace/);
    assert.doesNotMatch(report, /Every note that was found was read/);
  });

  test('deckard.me that names nobody is a warning; unset is only a note', () => {
    const unknown = buildSetupReport({ ...healthy(), me: '@ren', meIsKnown: false, tasksForMe: 0 }, at);
    assert.match(unknown, /⚠️ `deckard.me` is `@ren`, but no note names that person/);
    assert.match(unknown, /people are written with `@` here/);
    const unset = buildSetupReport({ ...healthy(), me: undefined, meIsKnown: false, tasksForMe: 0 }, at);
    assert.match(unset, /ℹ️ `deckard.me` is not set/);
    assert.doesNotMatch(unset, /⚠️/);
  });

  test('no folder open, and no tags in any note, each say what to do', () => {
    const bare = buildSetupReport({ ...healthy(), folders: [], scan: { found: 0, templates: 0, excluded: 0, read: 0 } }, at);
    assert.match(bare, /⚠️ No folder is open/);
    const untagged = buildSetupReport({ ...healthy(), indexed: { files: 5, sections: 5, tasks: 0, tags: 0 } }, at);
    assert.match(untagged, /⚠️ No tags were found in any note/);
    assert.match(untagged, /Tags are what Deckard connects notes by/);
  });
});
