import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { Task } from '../domain/model';
import { TaskService } from '../services/taskService';
import type { ResourceUri } from '../ports/uri';
import { FakeHistory, FakeNotes } from './fakeNotes';
import { FakeSettings } from './fakeWorkspace';

/** Mid-morning on Friday 2026-09-25. */
const now = new Date(2026, 8, 25, 10, 0, 0).getTime();

/** A task service over notes in memory, and what it did. */
function setup(notes: Record<string, string>, settings: Record<string, unknown> = {}) {
  const fake = new FakeNotes(notes);
  const history = new FakeHistory(fake);
  const ranks: [string, string][] = [];
  const own: string[] = [];
  const service = new TaskService<ResourceUri, number>({
    notes: fake,
    history,
    ownWrites: { note: (uri) => own.push(uri) },
    keepRank: (from, to) => ranks.push([from, to]),
    resolveUri: async (filePath) => (filePath.startsWith('gone/') ? undefined : fake.uri(filePath)),
    configuration: new FakeSettings(settings),
    clock: { now: () => now },
  });
  return { fake, history, ranks, own, service };
}

/** The tasks a note reads as, as the index read them. */
function tasksOf(path: string, text: string): Task[] {
  return parseMarkdown(path, text).tasks;
}

suite('Task service', () => {
  test('rewrites a task line, saves it as its own write, and carries the rank', async () => {
    const text = '# Plan\n- [ ] Send proposal\n';
    const { fake, ranks, own, service } = setup({ 'plan.md': text });
    const [task] = tasksOf('plan.md', text);
    const result = await service.updateLine(task, (line, context) => {
      assert.strictEqual(context.lineIndex, 1);
      assert.strictEqual(context.eol, '\n');
      return line.replace('[ ]', '[x]');
    });
    assert.strictEqual(result.kind, 'updated');
    assert.strictEqual(fake.text('plan.md'), '# Plan\n- [x] Send proposal\n');
    assert.deepStrictEqual(own, [fake.uri('plan.md').toString()]);
    assert.strictEqual(ranks.length, 1);
    assert.strictEqual(ranks[0][0], task.id);
    if (result.kind === 'updated') {
      assert.deepStrictEqual(result.written, {
        uri: fake.uri('plan.md'),
        lineNumber: 2,
        replacement: '- [x] Send proposal',
        original: '- [ ] Send proposal',
        filePath: 'plan.md',
      });
    }
  });

  test('writes nothing for an edit that changes nothing, a missing note, or a changed line', async () => {
    const text = '- [ ] Send proposal\n';
    const { fake, service } = setup({ 'plan.md': text });
    const [task] = tasksOf('plan.md', text);
    assert.deepStrictEqual(await service.updateLine(task, (line) => line), { kind: 'unchanged' });
    assert.deepStrictEqual(await service.updateLine({ ...task, filePath: 'gone/plan.md' }, (line) => `${line}!`), {
      kind: 'missing',
    });
    fake.texts.set(fake.uri('plan.md').toString(), '- [ ] Send the proposal\n');
    assert.deepStrictEqual(await service.updateLine(task, (line) => `${line}!`), {
      kind: 'stale',
      uri: fake.uri('plan.md'),
    });
    assert.deepStrictEqual(await service.updateLine({ ...task, lineNumber: 9 }, (line) => `${line}!`), {
      kind: 'stale',
      uri: fake.uri('plan.md'),
    });
  });

  test('tells a refused edit from one that was made but not saved, and from a failure', async () => {
    const text = '- [ ] Send proposal\n';
    const [task] = tasksOf('plan.md', text);
    const uri = setup({}).fake.uri('plan.md');

    const refused = setup({ 'plan.md': text });
    refused.fake.refuse = true;
    assert.deepStrictEqual(await refused.service.updateLine(task, (line) => `${line}!`), { kind: 'rejected', uri });

    const unsaved = setup({ 'plan.md': text });
    unsaved.fake.failSave = 'refuse';
    assert.deepStrictEqual(await unsaved.service.updateLine(task, (line) => `${line}!`), { kind: 'unsaved', uri });
    assert.deepStrictEqual(unsaved.ranks, [], 'no rank moves for an unsaved edit');

    const error = new Error('disk full');
    const throwing = setup({ 'plan.md': text });
    throwing.fake.failSave = error;
    assert.deepStrictEqual(await throwing.service.updateLine(task, (line) => `${line}!`), {
      kind: 'unsaved',
      uri,
      error,
    });

    const unreadable = setup({ 'plan.md': text });
    unreadable.fake.failOpen = error;
    assert.deepStrictEqual(await unreadable.service.updateLine(task, (line) => `${line}!`), {
      kind: 'failed',
      uri,
      error,
    });
    const transformError = setup({ 'plan.md': text });
    const failed = await transformError.service.updateLine(task, () => {
      throw error;
    });
    assert.deepStrictEqual(failed, { kind: 'failed', uri, error });
  });

  test('completes a task with its done date, and says what its repeat rule started', async () => {
    const text = '- [ ] Water plants 🔁 every week 📅 2026-09-25\n';
    const { fake, service } = setup({ 'plan.md': text });
    const [task] = tasksOf('plan.md', text);
    const result = await service.toggle(task, true);
    assert.strictEqual(
      fake.text('plan.md'),
      '- [ ] Water plants 🔁 every week 📅 2026-10-02\n- [x] Water plants 🔁 every week 📅 2026-09-25 ✅ 2026-09-25\n',
    );
    assert.strictEqual(result.kind, 'updated');
    const outcome = result.kind === 'updated' ? result.outcome : undefined;
    assert.strictEqual(outcome?.next, '- [ ] Water plants 🔁 every week 📅 2026-10-02');
    assert.strictEqual(outcome?.unreadRule, undefined);
    assert.deepStrictEqual(outcome?.family, { openSteps: 0, writtenLine: 1 });
  });

  test('reopens a task, and leaves the done date off when the settings say so', async () => {
    const done = '- [x] Send proposal ✅ 2026-09-20\n';
    const reopening = setup({ 'plan.md': done });
    const reopened = await reopening.service.toggle(tasksOf('plan.md', done)[0], false);
    assert.strictEqual(reopening.fake.text('plan.md'), '- [ ] Send proposal\n');
    assert.strictEqual(reopened.kind === 'updated' ? reopened.outcome : 'none', undefined);

    const open = '- [ ] Send proposal\n';
    const plain = setup({ 'plan.md': open }, { 'deckard.tasks.addDoneDate': false });
    await plain.service.toggle(tasksOf('plan.md', open)[0], true);
    assert.strictEqual(plain.fake.text('plan.md'), '- [x] Send proposal\n');
  });

  test('puts a line back, and leaves a line changed since alone', async () => {
    const text = '- [ ] Water plants 🔁 every week 📅 2026-09-25\n';
    const { fake, ranks, own, service } = setup({ 'plan.md': text });
    const [task] = tasksOf('plan.md', text);
    const result = await service.toggle(task, true);
    assert.strictEqual(result.kind, 'updated');
    if (result.kind !== 'updated') {
      return;
    }
    own.length = 0;
    assert.deepStrictEqual(await service.revertLine(result.written), { kind: 'reverted' });
    assert.strictEqual(fake.text('plan.md'), text);
    assert.deepStrictEqual(own, [], 'an Undo is not marked as Deckard’s own save');
    assert.strictEqual(ranks.length, 2);
    assert.deepStrictEqual(ranks[1], [ranks[0][1], task.id], 'the rank goes back to the task it was');

    assert.deepStrictEqual(await service.revertLine(result.written), { kind: 'stale', uri: fake.uri('plan.md') });
    assert.deepStrictEqual(
      await service.revertLine({ ...result.written, lineNumber: 0 }),
      { kind: 'stale', uri: fake.uri('plan.md') },
    );
  });

  test('says when putting a line back was refused or failed', async () => {
    const text = '- [x] Send proposal\n';
    const written = { uri: new FakeNotes().uri('plan.md'), lineNumber: 1, replacement: '- [x] Send proposal', original: '- [ ] Send proposal' };
    const refused = setup({ 'plan.md': text });
    refused.fake.refuse = true;
    assert.deepStrictEqual(await refused.service.revertLine(written), { kind: 'rejected' });
    const error = new Error('gone');
    const failing = setup({ 'plan.md': text });
    failing.fake.failOpen = error;
    assert.deepStrictEqual(await failing.service.revertLine(written), { kind: 'failed', uri: written.uri, error });
  });

  test('opens an indexed task only while its line reads as the index read it', async () => {
    const text = '- [ ] Send proposal\n';
    const { fake, service } = setup({ 'plan.md': text });
    const [task] = tasksOf('plan.md', text);
    const opened = await service.openIndexedTask(task);
    assert.strictEqual(opened.kind === 'open' ? opened.line : opened.kind, '- [ ] Send proposal');
    assert.deepStrictEqual(await service.openIndexedTask({ ...task, filePath: 'gone/plan.md' }), { kind: 'missing' });
    assert.deepStrictEqual(await service.openIndexedTask({ ...task, checkboxColumn: 4 }), {
      kind: 'stale',
      uri: fake.uri('plan.md'),
    });
    const error = new Error('unreadable');
    fake.failOpen = error;
    assert.deepStrictEqual(await service.openIndexedTask(task), { kind: 'unreadable', uri: fake.uri('plan.md'), error });
  });

  test('finds the open task on a line, and nothing on a done one', async () => {
    const text = '- [ ] Open\n- [x] Done\n';
    const { fake, service } = setup({ 'plan.md': text });
    assert.strictEqual((await service.findOpenTaskAt(fake.uri('plan.md'), 'plan.md', 0))?.title, 'Open');
    assert.strictEqual(await service.findOpenTaskAt(fake.uri('plan.md'), 'plan.md', 1), undefined);
  });

  test('completes the open steps under a task in one write', async () => {
    const text = '- [ ] Trip\n  - [ ] Book\n  - [x] Pack\n  - [ ] Go\n';
    const { fake, history, service } = setup({ 'plan.md': text });
    const result = await service.completeSteps(fake.uri('plan.md'), 0, 'Trip');
    assert.deepStrictEqual(result, { kind: 'written', count: 2, handle: 1 });
    assert.strictEqual(
      fake.text('plan.md'),
      '- [ ] Trip\n  - [x] Book ✅ 2026-09-25\n  - [x] Pack\n  - [x] Go ✅ 2026-09-25\n',
    );
    assert.strictEqual(history.writes[0].options.label, 'completing 2 steps of "Trip"');
    assert.deepStrictEqual(await service.completeSteps(fake.uri('plan.md'), 0, 'Trip'), {
      kind: 'stale',
      uri: fake.uri('plan.md'),
    });
    fake.texts.set(fake.uri('plan.md').toString(), text);
    history.refuse = true;
    assert.deepStrictEqual(await service.completeSteps(fake.uri('plan.md'), 0, 'Trip'), {
      kind: 'rejected',
      uri: fake.uri('plan.md'),
    });
  });

  test('writes steps under a task, after the ones it has', async () => {
    const text = '- [ ] Trip\n  - [ ] Book\nAfter\n';
    const { fake, history, service } = setup({ 'plan.md': text });
    const [task] = tasksOf('plan.md', text);
    assert.deepStrictEqual(await service.addSteps(task, []), { kind: 'nothing' });
    assert.deepStrictEqual(await service.addSteps(task, ['Pack', 'Go']), { kind: 'written', count: 2, handle: 1 });
    assert.strictEqual(fake.text('plan.md'), '- [ ] Trip\n  - [ ] Book\n  - [ ] Pack\n  - [ ] Go\nAfter\n');
    assert.strictEqual(history.writes[0].options.label, 'writing 2 steps under "Trip"');
  });

  test('writes no steps for a missing note, a changed line, a refusal, or a failure', async () => {
    const text = '- [ ] Trip\n';
    const [task] = tasksOf('plan.md', text);
    const uri = new FakeNotes().uri('plan.md');
    const { fake, history, service } = setup({ 'plan.md': text });
    assert.deepStrictEqual(await service.addSteps({ ...task, filePath: 'gone/plan.md' }, ['Pack']), { kind: 'missing' });
    history.refuse = true;
    assert.deepStrictEqual(await service.addSteps(task, ['Pack']), { kind: 'rejected', uri });
    fake.texts.set(uri.toString(), '- [ ] Trip, changed\n');
    assert.deepStrictEqual(await service.addSteps(task, ['Pack']), { kind: 'stale', uri });
    const error = new Error('unreadable');
    fake.failOpen = error;
    assert.deepStrictEqual(await service.addSteps(task, ['Pack']), { kind: 'failed', uri, error });
  });

  test('toggles an editor’s lines in one edit, and carries each rank below a next occurrence', async () => {
    const { ranks, service } = setup({});
    const lines = ['- [ ] One 🔁 every day 📅 2026-09-25', 'Prose', '- [ ] Two'];
    const applied: string[] = [];
    const request = {
      uri: new FakeNotes().uri('plan.md'),
      lines: lines.map((text, line) => ({ line, text })),
      documentLines: lines,
      eol: '\n',
      now,
      filePath: 'plan.md',
    };
    const outcome = await service.toggleLines(request, async (toggled) => {
      applied.push(...toggled.map((line) => line.after));
      return true;
    });
    assert.strictEqual(outcome.kind, 'toggled');
    assert.strictEqual(applied.length, 2);
    assert.strictEqual(ranks.length, 2);
    const [, second] = ranks;
    assert.strictEqual(second[1], parseMarkdown('plan.md', `\n\n\n${'- [x] Two ✅ 2026-09-25'}`).tasks[0].id);

    assert.deepStrictEqual(await service.toggleLines({ ...request, lines: [{ line: 1, text: 'Prose' }] }, async () => true), {
      kind: 'none',
    });
    assert.deepStrictEqual(await service.toggleLines(request, async () => false), { kind: 'rejected' });
    ranks.length = 0;
    const { filePath: _untitled, ...untitled } = request;
    await service.toggleLines(untitled, async () => true);
    assert.deepStrictEqual(ranks, [], 'an untitled note keeps no rank');
  });
});
