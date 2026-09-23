import * as assert from 'assert';

import {
  addedTaskLine,
  changeTaskLine,
  describeChange,
  readAddTaskInput,
  readChangeTaskInput,
} from '../ui/commands/assistantWrites';

suite('Assistant writes', () => {
  const NOW = Date.UTC(2026, 8, 21, 12);

  test('reads an add-task call, and refuses what an assistant should not send', () => {
    assert.deepStrictEqual(readAddTaskInput({ text: '  Call  Ren ' }), { text: 'Call Ren' });
    assert.deepStrictEqual(readAddTaskInput({ text: 'x', note: ' notes/a.md ' }), { text: 'x', note: 'notes/a.md' });
    for (const junk of [undefined, 'text', { text: '' }, { text: 42 }, { text: 'x'.repeat(501) }, { note: 'a.md' }]) {
      assert.strictEqual(readAddTaskInput(junk), undefined, JSON.stringify(junk));
    }
  });

  test('reads a change-task call: a note and a line, and at least one change', () => {
    assert.deepStrictEqual(
      readChangeTaskInput({ note: 'notes/a.md', line: 3, complete: true, due: '2026-09-30', priority: 'high', assignee: '@ren' }),
      { note: 'notes/a.md', line: 3, complete: true, due: '2026-09-30', priority: 'high', assignee: '@ren' },
    );
    assert.deepStrictEqual(readChangeTaskInput({ note: 'a.md', line: 1, due: null }), { note: 'a.md', line: 1, due: null }, 'null clears');
    for (const junk of [
      { note: 'a.md', line: 1 },
      { note: 'a.md', line: 0, complete: true },
      { note: 'a.md', line: 1.5, complete: true },
      { note: '', line: 1, complete: true },
      { note: 'a.md', line: 1, due: 'tomorrow' },
      { note: 'a.md', line: 1, priority: 'urgent' },
      { note: 'a.md', line: 1, assignee: 'two words' },
      { note: 'a.md', line: 1, complete: 'yes' },
      { note: 'a.md', line: 1, title: '' },
    ]) {
      assert.strictEqual(readChangeTaskInput(junk), undefined, JSON.stringify(junk));
    }
  });

  test('an added task is a task line', () => {
    assert.strictEqual(addedTaskLine('Call Ren 📅 2026-09-30'), '- [ ] Call Ren 📅 2026-09-30');
    assert.strictEqual(addedTaskLine('- [ ] already one'), '- [ ] already one');
  });

  test('changes touch only what they name, in the order Deckard writes fields', () => {
    const line = '- [ ] Call Ren about the budget 📅 2026-09-30 ⏫ #project/atlas';
    assert.strictEqual(changeTaskLine(line, { due: '2026-10-02' }, NOW), '- [ ] Call Ren about the budget #project/atlas ⏫ 📅 2026-10-02');
    assert.strictEqual(changeTaskLine(line, { priority: null }, NOW), '- [ ] Call Ren about the budget #project/atlas 📅 2026-09-30');
    assert.strictEqual(changeTaskLine(line, { assignee: '@ren' }, NOW), '- [ ] Call Ren about the budget #project/atlas ⏫ 📅 2026-09-30 👤 @ren');
    assert.strictEqual(changeTaskLine(line, { title: 'Call Ren' }, NOW), '- [ ] Call Ren ⏫ 📅 2026-09-30');
  });

  test('completing writes the done date, reopening takes it away, and the same state is a no-op', () => {
    const open = '- [ ] Ship it 📅 2026-09-30';
    const done = changeTaskLine(open, { complete: true }, NOW);
    assert.strictEqual(done, '- [x] Ship it 📅 2026-09-30 ✅ 2026-09-21');
    assert.strictEqual(changeTaskLine(done, { complete: false }, NOW), open);
    assert.strictEqual(changeTaskLine(open, { complete: false }, NOW), open, 'already open');
  });

  test('a Dataview line stays a Dataview line', () => {
    const line = '- [ ] Ship it [due:: 2026-09-30]';
    assert.strictEqual(changeTaskLine(line, { priority: 'high' }, NOW), '- [ ] Ship it [priority:: high] [due:: 2026-09-30]');
  });

  test('says what it is about to do, in words a preview can carry', () => {
    assert.strictEqual(describeChange({ complete: true, due: '2026-10-01' }), 'complete it, make it due 2026-10-01');
    assert.strictEqual(describeChange({ priority: null, assignee: null }), 'clear its priority, take it from whoever it was for');
  });
});
