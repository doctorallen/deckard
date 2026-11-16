import * as assert from 'assert';

import { MoveBlock, readMoveBlock } from '../domain/markdown/moveLines';
import { readSectionBlock } from '../domain/notes/moveSection';
import { parseMarkdown } from '../domain/markdown/parser';
import { Insertion, MoveService, MoveSource } from '../services/moveService';
import type { ResourceUri } from '../ports/uri';
import { FakeHistory, FakeNotes, noteUri } from './fakeNotes';
import { FakeFileSystem, FakeSettings } from './fakeWorkspace';

/**
 * Where moved lines go, as Capture places them for a list: on the line after
 * the last text of the note, or of the section.
 */
function placeAfterLastText(
  content: string,
  line: string,
  section?: { startLine: number; endLine: number },
): Insertion {
  const lines = content.split(/\r?\n/);
  let end = section ? Math.min(section.endLine, lines.length) - 1 : lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') {
    end -= 1;
  }
  return { line: end + 1, character: 0, text: `${line}\n`, taskLine: end + 1 };
}

/** A move service over notes in memory, and what it did. */
function setup(notes: Record<string, string>, settings: Record<string, unknown> = {}) {
  const fake = new FakeNotes(notes);
  const history = new FakeHistory(fake);
  const files = new FakeFileSystem();
  files.folders.add('.');
  const ranks: [string, string][] = [];
  const service = new MoveService<ResourceUri, number>({
    notes: fake,
    history,
    files,
    configuration: new FakeSettings(settings),
    getFilePath: (uri) => uri.fsPath,
    keepRank: (from, to) => ranks.push([from, to]),
    resolveUri: async (filePath) => (filePath.startsWith('gone/') ? undefined : noteUri(filePath)),
    placeInsertion: placeAfterLastText,
  });
  return { fake, history, files, ranks, service };
}

/** The block a cursor on a zero-based line of `text` moves. */
function blockAt(text: string, line: number): MoveBlock {
  const read = readMoveBlock(text.split(/\r?\n/), {
    start: { line, character: 0 },
    end: { line, character: 0 },
    isEmpty: true,
  });
  assert.ok(!('refused' in read), 'a block to move');
  return read;
}

const inbox = '# Inbox\n- [ ] Call Ren\n- [ ] Pay rent\n';
const plan = '# Plan\n\n## Calls\n- [ ] Book the room\n';

suite('Move service', () => {
  test('moves a task under a heading in another note, leaving a link, and keeps its rank', async () => {
    const { fake, history, ranks, service } = setup({ 'inbox.md': inbox, 'plan.md': plan });
    const [task] = parseMarkdown('inbox.md', inbox).tasks;
    const source: MoveSource<ResourceUri> = { uri: noteUri('inbox.md'), filePath: 'inbox.md', block: blockAt(inbox, 1), task };
    const result = await service.move([source], {
      uri: noteUri('plan.md'),
      link: 'plan#Calls',
      name: 'plan › Calls',
      section: { startLine: 3, endLine: 4 },
    });
    assert.deepStrictEqual(result, { kind: 'moved', handle: 1, created: false });
    assert.strictEqual(fake.text('inbox.md'), '# Inbox\n- [>] Call Ren → [[plan#Calls]]\n- [ ] Pay rent\n');
    assert.strictEqual(fake.text('plan.md'), '# Plan\n\n## Calls\n- [ ] Book the room\n- [ ] Call Ren\n');
    assert.deepStrictEqual(history.writes[0].options.label, 'Move to…');
    assert.deepStrictEqual(history.writes[0].options.description, 'Moved to plan › Calls');
    assert.strictEqual(history.writes[0].options.preview, 'never');
    assert.strictEqual(history.writes[0].options.together, true, 'both notes go back on an Undo, or neither');
    assert.deepStrictEqual(ranks, [[task.id, parseMarkdown('plan.md', fake.text('plan.md') ?? '').tasks[1].id]]);
  });

  test('creates the new note it moves into, and its Undo deletes that note again', async () => {
    const { fake, files, history, ranks, service } = setup({ 'inbox.md': inbox });
    const result = await service.move([{ uri: noteUri('inbox.md'), filePath: 'inbox.md', block: blockAt(inbox, 1) }], {
      uri: noteUri('Call Ren.md'),
      link: 'Call Ren',
      name: 'Call Ren',
      create: '# Call Ren\n\n',
    });
    assert.deepStrictEqual(result, { kind: 'moved', handle: 1, created: true });
    assert.strictEqual(new TextDecoder().decode(files.files.get('Call Ren.md')), '# Call Ren\n\n- [ ] Call Ren\n');
    assert.strictEqual(fake.text('inbox.md'), '# Inbox\n- [>] Call Ren → [[Call Ren]]\n- [ ] Pay rent\n');
    assert.deepStrictEqual(ranks, [], 'a created note is read by the index, not ranked here');
    await history.writes[0].options.restore?.();
    assert.strictEqual(files.files.has('Call Ren.md'), false, 'Undo deletes the note it made');
  });

  test('writes a new note from a CRLF note in CRLF throughout', async () => {
    const crlf = '# Inbox\r\n- [ ] Call Ren\r\n  - [ ] Find number\r\n';
    const { files, service } = setup({ 'inbox.md': crlf });
    const result = await service.move([{ uri: noteUri('inbox.md'), filePath: 'inbox.md', block: blockAt(crlf, 1) }], {
      uri: noteUri('Call Ren.md'),
      link: 'Call Ren',
      name: 'Call Ren',
      create: '# Call Ren\n\n',
    });
    assert.strictEqual(result.kind, 'moved');
    assert.strictEqual(
      new TextDecoder().decode(files.files.get('Call Ren.md')),
      '# Call Ren\r\n\r\n- [ ] Call Ren\r\n  - [ ] Find number\r\n',
    );
  });

  test('writes nothing when what moves changed, and deletes a note it made for a failed write', async () => {
    const changed = setup({ 'inbox.md': inbox, 'plan.md': plan });
    const block = blockAt(inbox, 1);
    changed.fake.texts.set(noteUri('inbox.md').toString(), '# Inbox\n- [ ] Call Ren today\n');
    assert.deepStrictEqual(
      await changed.service.move([{ uri: noteUri('inbox.md'), filePath: 'inbox.md', block }], {
        uri: noteUri('plan.md'),
        link: 'plan',
        name: 'plan',
      }),
      { kind: 'stale' },
    );
    assert.strictEqual(changed.history.writes.length, 0);

    const refused = setup({ 'inbox.md': inbox });
    refused.history.refuse = true;
    assert.deepStrictEqual(
      await refused.service.move([{ uri: noteUri('inbox.md'), filePath: 'inbox.md', block }], {
        uri: noteUri('New.md'),
        link: 'New',
        name: 'New',
        create: '# New\n\n',
      }),
      { kind: 'failed' },
    );
    assert.strictEqual(refused.files.files.has('New.md'), false);
    assert.strictEqual(refused.fake.text('inbox.md'), inbox);
  });

  test('reads indexed tasks as blocks, leaving out a missing note, and refuses a changed line', async () => {
    const { fake, service } = setup({ 'inbox.md': inbox });
    const tasks = parseMarkdown('inbox.md', inbox).tasks;
    const read = await service.readTasks([...tasks, { ...tasks[0], filePath: 'gone/inbox.md' }]);
    assert.strictEqual(read.kind, 'sources');
    assert.deepStrictEqual(read.kind === 'sources' ? read.sources.map((source) => source.block.lines) : [], [
      ['- [ ] Call Ren'],
      ['- [ ] Pay rent'],
    ]);
    fake.texts.set(noteUri('inbox.md').toString(), '# Inbox\n- [ ] Call Ren later\n- [ ] Pay rent\n');
    assert.deepStrictEqual(await service.readTasks(tasks), { kind: 'stale' });
  });

  test('moves a task chosen together with its own step once, step and all', async () => {
    const trip = '# Inbox\n- [ ] Plan trip 📅 2026-10-01\n  - [ ] Book hotel 📅 2026-10-01\n- [ ] Other\n';
    const { fake, service } = setup({ 'inbox.md': trip, 'plan.md': '# Plan\n' });
    const [task, step] = parseMarkdown('inbox.md', trip).tasks;
    // The step comes first, as a list sorted by due date may give it.
    const read = await service.readTasks([step, task]);
    assert.strictEqual(read.kind, 'sources');
    const sources = read.kind === 'sources' ? read.sources : [];
    assert.deepStrictEqual(sources.map((source) => source.block.lines), [
      ['- [ ] Plan trip 📅 2026-10-01', '  - [ ] Book hotel 📅 2026-10-01'],
    ]);
    const result = await service.move(sources, { uri: noteUri('plan.md'), link: 'plan', name: 'plan' });
    assert.strictEqual(result.kind, 'moved');
    assert.strictEqual(fake.text('inbox.md'), '# Inbox\n- [>] Plan trip 📅 2026-10-01 → [[plan]]\n- [ ] Other\n');
    assert.strictEqual(fake.text('plan.md'), '# Plan\n- [ ] Plan trip 📅 2026-10-01\n  - [ ] Book hotel 📅 2026-10-01\n');
  });
  test('moves a section under a heading, nested one deeper, leaving one link to it in the link style', async () => {
    const day = '# 2026-11-12\n\n## Ledger cutover plan\nCut over Friday.\n\n### Steps\n- [ ] Freeze writes\n\n## Lunch\n';
    const migration = '# Ledger migration\n\n## Plan\n- Draft\n\n## Risks\n- None yet\n';
    const { fake, history, service } = setup(
      { 'journal/2026-11-12.md': day, 'Ledger migration.md': migration },
      { 'deckard.links.style': 'markdown' },
    );
    const block = readSectionBlock(day.split('\n'), { start: { line: 2, character: 0 }, end: { line: 2, character: 0 }, isEmpty: true });
    assert.ok(block);
    const result = await service.move([{ uri: noteUri('journal/2026-11-12.md'), filePath: 'journal/2026-11-12.md', block }], {
      uri: noteUri('Ledger migration.md'),
      link: 'Ledger migration#Plan',
      name: 'Ledger migration › Plan',
      section: { startLine: 3, endLine: 5, headingLevel: 2 },
    });
    assert.deepStrictEqual(result, { kind: 'moved', handle: 1, created: false });
    assert.strictEqual(
      fake.text('Ledger migration.md'),
      '# Ledger migration\n\n## Plan\n- Draft\n\n### Ledger cutover plan\nCut over Friday.\n\n#### Steps\n- [ ] Freeze writes\n\n## Risks\n- None yet\n',
    );
    assert.strictEqual(
      fake.text('journal/2026-11-12.md'),
      '# 2026-11-12\n\n[Ledger migration#Ledger cutover plan](../Ledger%20migration.md#ledger-cutover-plan)\n\n## Lunch\n',
    );
    assert.strictEqual(history.writes[0].options.together, true, 'both notes go back on an Undo, or neither');
  });

  test('moves a section to the end of a note with its levels kept, and into a new note as it was written', async () => {
    const day = '# 2026-11-12\n## Ledger cutover plan\n### Steps\n- [ ] Freeze writes\n';
    const atEnd = setup({ 'day.md': day, 'Ledger migration.md': '# Ledger migration\n- Draft\n' });
    const block = readSectionBlock(day.split('\n'), { start: { line: 1, character: 0 }, end: { line: 1, character: 0 }, isEmpty: true });
    assert.ok(block);
    await atEnd.service.move([{ uri: noteUri('day.md'), filePath: 'day.md', block }], {
      uri: noteUri('Ledger migration.md'),
      link: 'Ledger migration',
      name: 'Ledger migration',
    });
    assert.strictEqual(atEnd.fake.text('Ledger migration.md'), '# Ledger migration\n- Draft\n\n## Ledger cutover plan\n### Steps\n- [ ] Freeze writes\n');
    assert.strictEqual(atEnd.fake.text('day.md'), '# 2026-11-12\n[[Ledger migration#Ledger cutover plan]]\n');

    const created = setup({ 'day.md': day });
    await created.service.move([{ uri: noteUri('day.md'), filePath: 'day.md', block }], {
      uri: noteUri('Ledger cutover plan.md'),
      link: 'Ledger cutover plan',
      name: 'Ledger cutover plan',
      create: '',
    });
    assert.strictEqual(
      new TextDecoder().decode(created.files.files.get('Ledger cutover plan.md')),
      '## Ledger cutover plan\n### Steps\n- [ ] Freeze writes\n',
    );
    assert.strictEqual(created.fake.text('day.md'), '# 2026-11-12\n[[Ledger cutover plan]]\n');
  });

  test('a section that leaves a daily note takes the day into its heading, and the link left names it so', async () => {
    const day = '# 2026-11-16\n\n## Vendor sync #project/borealis @dana\n- The gateway is included\n\n### Pricing\n- [ ] Send the quote\n';
    const hub = '---\ndescribes: project/borealis\n---\n# Borealis\n\nThe ledger migration.\n';
    const section = (text: string, line: number): MoveBlock => {
      const block = readSectionBlock(text.split('\n'), { start: { line, character: 0 }, end: { line, character: 0 }, isEmpty: true });
      assert.ok(block);
      return block;
    };
    const source = { uri: noteUri('2026-11-16.md'), filePath: '2026-11-16.md', block: section(day, 2), day: '2026-11-16' };

    const atEnd = setup({ '2026-11-16.md': day, 'Borealis.md': hub });
    await atEnd.service.move([source], { uri: noteUri('Borealis.md'), link: 'Borealis', name: 'Borealis' });
    assert.strictEqual(
      atEnd.fake.text('Borealis.md'),
      `${hub}\n## 2026-11-16 Vendor sync #project/borealis @dana\n- The gateway is included\n\n### Pricing\n- [ ] Send the quote\n`,
    );
    assert.strictEqual(atEnd.fake.text('2026-11-16.md'), '# 2026-11-16\n\n[[Borealis#2026-11-16 Vendor sync]]\n');
    const moved = parseMarkdown('Borealis.md', atEnd.fake.text('Borealis.md') ?? '');
    assert.strictEqual(moved.sections.find((entry) => entry.heading.includes('Vendor sync'))?.dated, '2026-11-16');

    // Under a heading it is one level deeper, and dated all the same.
    const nested = setup({ '2026-11-16.md': day, 'Borealis.md': `${hub}\n## Meetings\n` });
    await nested.service.move([source], {
      uri: noteUri('Borealis.md'),
      link: 'Borealis#Meetings',
      name: 'Borealis › Meetings',
      section: { startLine: 8, endLine: 8, headingLevel: 2 },
    });
    assert.match(nested.fake.text('Borealis.md') ?? '', /\n### 2026-11-16 Vendor sync #project\/borealis @dana\n/);

    // Another daily note dates it already, and so does a day of its own.
    const daily = setup({ '2026-11-16.md': day, '2026-11-17.md': '# 2026-11-17\n' });
    await daily.service.move([source], { uri: noteUri('2026-11-17.md'), link: '2026-11-17', name: '2026-11-17', daily: true });
    assert.match(daily.fake.text('2026-11-17.md') ?? '', /\n## Vendor sync #project\/borealis @dana\n/);
    const dated = '# 2026-11-16\n\n## 2026-11-13 Kickoff\n- Late notes\n';
    const kept = setup({ '2026-11-16.md': dated, 'Borealis.md': hub });
    await kept.service.move(
      [{ uri: noteUri('2026-11-16.md'), filePath: '2026-11-16.md', block: section(dated, 2), day: '2026-11-16' }],
      { uri: noteUri('Borealis.md'), link: 'Borealis', name: 'Borealis' },
    );
    assert.match(kept.fake.text('Borealis.md') ?? '', /\n## 2026-11-13 Kickoff\n/);

    // A top-level heading is left as written: with a day in it, its new note would be a daily note.
    const top = '# Vendor sync\n- Notes\n';
    const whole = setup({ '2026-11-16.md': top });
    await whole.service.move(
      [{ uri: noteUri('2026-11-16.md'), filePath: '2026-11-16.md', block: section(top, 0), day: '2026-11-16' }],
      { uri: noteUri('Vendor sync.md'), link: 'Vendor sync', name: 'Vendor sync', create: '' },
    );
    assert.strictEqual(new TextDecoder().decode(whole.files.files.get('Vendor sync.md')), '# Vendor sync\n- Notes\n');
  });

  test('copies lines where they are sent with a link to the heading they were under, and leaves them', async () => {
    const day = '# 2026-11-16\n\n## Vendor sync #project/borealis\n- The gateway is included in the base price ^gateway\n  - Confirmed by Dana\n- [ ] Send the quote\n';
    const wiki = '# Pricing\n\n## Vendors\n- Quotes are good for 30 days\n';
    const { fake, history, ranks, service } = setup({ '2026-11-16.md': day, 'wiki/Pricing.md': wiki });
    const target = {
      uri: noteUri('wiki/Pricing.md'),
      link: 'Pricing#Vendors',
      name: 'Pricing › Vendors',
      section: { startLine: 3, endLine: 4, headingLevel: 2 },
    };
    const result = await service.move(
      [{ uri: noteUri('2026-11-16.md'), filePath: '2026-11-16.md', block: blockAt(day, 3) }],
      target,
      { copy: true },
    );
    assert.deepStrictEqual(result, { kind: 'moved', handle: 1, created: false });
    assert.strictEqual(fake.text('2026-11-16.md'), day, 'what was copied stays as it was');
    assert.strictEqual(
      fake.text('wiki/Pricing.md'),
      `${wiki}- The gateway is included in the base price ([[2026-11-16#Vendor sync]]) ^gateway\n  - Confirmed by Dana\n`,
    );
    assert.strictEqual(history.writes[0].options.label, 'Copy to…');
    assert.strictEqual(history.writes[0].options.description, 'Copied to Pricing › Vendors');

    // A copied task is a second task, with no rank to carry.
    const [task] = parseMarkdown('2026-11-16.md', day).tasks;
    await service.move(
      [{ uri: noteUri('2026-11-16.md'), filePath: '2026-11-16.md', block: blockAt(day, 5), task }],
      { ...target, section: { startLine: 3, endLine: 6, headingLevel: 2 } },
      { copy: true },
    );
    assert.match(fake.text('wiki/Pricing.md') ?? '', /\n- \[ \] Send the quote \(\[\[2026-11-16#Vendor sync\]\]\)\n$/);
    assert.strictEqual(fake.text('2026-11-16.md'), day);
    assert.deepStrictEqual(ranks, []);
  });

  test('copies a section with the link under its heading, in the link style of the note it goes to', async () => {
    const day = '# 2026-11-16\n\n## Vendor sync #project/borealis\n- The gateway is included\n';
    const { fake, service } = setup(
      { 'journal/2026-11-16.md': day, 'Borealis.md': '# Borealis\n' },
      { 'deckard.links.style': 'markdown' },
    );
    const block = readSectionBlock(day.split('\n'), { start: { line: 2, character: 0 }, end: { line: 2, character: 0 }, isEmpty: true });
    assert.ok(block);
    await service.move(
      [{ uri: noteUri('journal/2026-11-16.md'), filePath: 'journal/2026-11-16.md', block, day: '2026-11-16' }],
      { uri: noteUri('Borealis.md'), link: 'Borealis', name: 'Borealis' },
      { copy: true },
    );
    assert.strictEqual(fake.text('journal/2026-11-16.md'), day);
    assert.strictEqual(
      fake.text('Borealis.md'),
      '# Borealis\n\n## 2026-11-16 Vendor sync #project/borealis\n([2026-11-16#Vendor sync](journal/2026-11-16.md#vendor-sync))\n- The gateway is included\n',
    );
  });

  test('writes nothing when the section changed while the destination was chosen', async () => {
    const day = '# Day\n## Ledger cutover plan\n- Freeze writes\n';
    const { fake, history, service } = setup({ 'day.md': day, 'plan.md': '# Plan\n' });
    const block = readSectionBlock(day.split('\n'), { start: { line: 1, character: 0 }, end: { line: 1, character: 0 }, isEmpty: true });
    assert.ok(block);
    fake.texts.set(noteUri('day.md').toString(), '# Day\n## Ledger cutover plan\n- Freeze writes Friday\n');
    assert.deepStrictEqual(
      await service.move([{ uri: noteUri('day.md'), filePath: 'day.md', block }], { uri: noteUri('plan.md'), link: 'plan', name: 'plan' }),
      { kind: 'stale' },
    );
    assert.strictEqual(history.writes.length, 0);
  });
});
