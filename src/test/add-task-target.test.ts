import * as assert from 'assert';

import {
  describeTaskTarget,
  listNoteChoices,
  listTaskTargetChoices,
  placeTaskHere,
  titleTaskTarget,
} from '../ui/state/addTaskTarget';

/**
 * Where Add Task writes, as its editor names it: the title, the Note row,
 * the places the row offers, the notes Another note… lists, and where on
 * the cursor's line a task goes.
 */
suite('Add Task: where the task goes', () => {
  test('the title names the note plainly, and a heading in it', () => {
    assert.strictEqual(titleTaskTarget({ kind: 'today', path: 'notes/2026-10-06.md' }), 'Add a task to 2026-10-06.md');
    assert.strictEqual(titleTaskTarget({ kind: 'here', path: 'notes/projects/atlas.md' }), 'Add a task to atlas.md');
    assert.strictEqual(titleTaskTarget({ kind: 'note', path: 'plan.md' }), 'Add a task to plan.md');
    assert.strictEqual(
      titleTaskTarget({ kind: 'heading', path: 'notes/atlas.md', heading: 'Next steps' }),
      'Add a task under Next steps in atlas.md',
    );
  });

  test('the Note row says the path, and which note it is', () => {
    assert.strictEqual(describeTaskTarget({ kind: 'here', path: 'notes/atlas.md' }), 'notes/atlas.md · this note');
    assert.strictEqual(describeTaskTarget({ kind: 'today', path: 'notes/2026-10-06.md' }), 'notes/2026-10-06.md · today’s note');
    assert.strictEqual(describeTaskTarget({ kind: 'note', path: 'notes/plan.md' }), 'notes/plan.md');
    assert.strictEqual(
      describeTaskTarget({ kind: 'heading', path: 'notes/atlas.md', heading: 'Next steps' }),
      'Next steps · notes/atlas.md',
    );
  });

  test('offers this note when one is open, today’s, another, and a heading, the current one said', () => {
    const here = { kind: 'here' as const, path: 'notes/atlas.md' };
    assert.deepStrictEqual(
      listTaskTargetChoices(here, { here: here.path, today: 'notes/2026-10-06.md' }).map((choice) => [choice.target, choice.label, choice.description]),
      [
        ['here', '$(edit) This note', 'notes/atlas.md · now'],
        ['today', '$(calendar) Today’s note', 'notes/2026-10-06.md'],
        ['note', '$(file) Another note…', 'The notes changed last first'],
        ['heading', '$(list-tree) Under a heading…', 'In any note, the headings used last first'],
      ],
    );
    assert.deepStrictEqual(
      listTaskTargetChoices({ kind: 'today', path: '2026-10-06.md' }, { today: '2026-10-06.md' }).map((choice) => [choice.target, choice.description]),
      [
        ['today', '2026-10-06.md · now'],
        ['note', 'The notes changed last first'],
        ['heading', 'In any note, the headings used last first'],
      ],
      'no note open, no This note',
    );
    const chosen = listTaskTargetChoices(
      { kind: 'heading', path: 'notes/atlas.md', heading: 'Next steps' },
      { today: '2026-10-06.md' },
    );
    assert.strictEqual(chosen.find((choice) => choice.target === 'heading')?.description, 'Next steps · now');
    assert.strictEqual(
      listTaskTargetChoices({ kind: 'note', path: 'notes/plan.md' }, { today: '2026-10-06.md' }).find((choice) => choice.target === 'note')?.description,
      'notes/plan.md · now',
    );
  });

  test('Another note… lists the note changed last first, by name, with its folder', () => {
    assert.deepStrictEqual(
      listNoteChoices([
        { filePath: 'notes/old.md', updatedAt: 1 },
        { filePath: 'notes/projects/atlas.md', updatedAt: 3 },
        { filePath: 'top.md' },
        { filePath: 'notes/b.md', updatedAt: 1 },
      ]),
      [
        { filePath: 'notes/projects/atlas.md', label: 'atlas.md', description: 'notes/projects' },
        { filePath: 'notes/b.md', label: 'b.md', description: 'notes' },
        { filePath: 'notes/old.md', label: 'old.md', description: 'notes' },
        { filePath: 'top.md', label: 'top.md', description: '' },
      ],
    );
  });

  test('a blank line or plain words take the task; a task, selected words, or a column’s task go below', () => {
    assert.deepStrictEqual(placeTaskHere('', { isTask: false, seeded: false }), { mode: 'line' });
    assert.deepStrictEqual(placeTaskHere('   ', { isTask: false, seeded: true }), { mode: 'line' });
    assert.deepStrictEqual(placeTaskHere('Call Ren about the budget', { isTask: false, seeded: false }), { mode: 'line' });
    assert.deepStrictEqual(placeTaskHere('  - [ ] Call Ren', { isTask: true, seeded: false }), { mode: 'below', indent: '  ' });
    assert.deepStrictEqual(placeTaskHere('Ask Ren about the budget', { isTask: false, seeded: true }), { mode: 'below', indent: '' });
    assert.deepStrictEqual(placeTaskHere('\t1. First', { isTask: false, seeded: true }), { mode: 'below', indent: '\t' });
  });
});
