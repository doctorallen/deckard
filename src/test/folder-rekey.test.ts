import * as assert from 'assert';

import { tidyAfterUpdate } from '../composition/tidyPreferences';
import { findRekeyedNotes } from '../domain/index/folderRekey';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { ParsedFile } from '../domain/model';
import { createPreferences } from './preferenceServices';

/** The index of `files`, keyed by path. */
function indexOf(...files: ParsedFile[]) {
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

class MemoryStore {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const ATLAS = '# Atlas #project/atlas\n- [ ] Ship it\n## Plan\nWords.\n';
const LOG = '# Log\n- [ ] Write it up\n';

/** The index of the two notes, each path behind `prefix`: '' for one workspace folder, 'notes/' for more. */
function indexUnder(prefix: string) {
  return indexOf(parseMarkdown(`${prefix}atlas.md`, ATLAS), parseMarkdown(`${prefix}log.md`, LOG));
}

suite('Adding or removing a second workspace folder', () => {
  test('matches each note to its path under the folder key, and its tasks and headings to their new ids', () => {
    const one = indexUnder('');
    const two = indexUnder('notes/');
    const rekeyed = findRekeyedNotes(one, two);
    assert.deepStrictEqual([...rekeyed.files], [
      ['atlas.md', 'notes/atlas.md'],
      ['log.md', 'notes/log.md'],
    ]);
    assert.deepStrictEqual([...rekeyed.tasks.values()].sort(), [...two.tasks.keys()].sort());
    assert.deepStrictEqual([...rekeyed.sections.values()].sort(), [...two.sections.keys()].sort());
    assert.deepStrictEqual(
      [...findRekeyedNotes(two, one).files],
      [
        ['notes/atlas.md', 'atlas.md'],
        ['notes/log.md', 'log.md'],
      ],
      'and back again when the folder is removed',
    );
  });

  test('leaves a note whose text changed, or a note only created or deleted, to the prune', () => {
    const one = indexUnder('');
    const changed = indexOf(
      parseMarkdown('notes/atlas.md', `${ATLAS}More.\n`),
      parseMarkdown('notes/new.md', LOG),
    );
    assert.strictEqual(findRekeyedNotes(one, changed).files.size, 0);
  });

  test('keeps task order, view counts, Find choices, recent headings, and pins, both ways', async () => {
    const one = indexUnder('');
    const two = indexUnder('notes/');
    const preferences = createPreferences(new MemoryStore());
    const [atlasTask, logTask] = [...one.tasks.values()];
    const plan = [...one.sections.values()].find((section) => section.heading === 'Plan');
    assert.ok(plan);
    await preferences.taskLayout.setTaskOrder([logTask.id, atlasTask.id]);
    await preferences.usage.recordSectionAccess(plan.id, 30);
    await preferences.usage.recordFindChoice('atl', 'note:["atlas.md","Atlas",0]', 40);
    await preferences.usage.recordRecentHeading({ filePath: 'atlas.md', heading: 'Plan', headingLevel: 2, occurrence: 0 });
    await preferences.pins.pinNote({ filePath: 'log.md' });
    await preferences.maintenance.prune(one);
    const before = preferences.repository.snapshot();

    await tidyAfterUpdate(one, two, preferences);
    const added = preferences.repository.snapshot();
    const newPlan = [...two.sections.values()].find((section) => section.heading === 'Plan');
    assert.ok(newPlan);
    assert.deepStrictEqual(added.taskOrder, [...two.tasks.values()].map((task) => task.id).reverse());
    assert.strictEqual(added.sectionAccessCounts[newPlan.id], before.sectionAccessCounts[plan.id]);
    assert.deepStrictEqual(added.findChoices?.map((choice) => choice.key), ['note:["notes/atlas.md","Atlas",0]']);
    assert.deepStrictEqual(added.recentHeadings?.map((pin) => pin.filePath), ['notes/atlas.md']);
    assert.deepStrictEqual(added.pinnedNotes?.map((pin) => pin.filePath), ['notes/log.md']);

    await tidyAfterUpdate(two, one, preferences);
    const removed = preferences.repository.snapshot();
    assert.deepStrictEqual(removed.taskOrder, before.taskOrder);
    assert.deepStrictEqual(removed.sectionAccessCounts, before.sectionAccessCounts);
    assert.deepStrictEqual(removed.findChoices, before.findChoices);
    assert.deepStrictEqual(removed.recentHeadings, before.recentHeadings);
    assert.deepStrictEqual(removed.pinnedNotes, before.pinnedNotes);
  });
});
