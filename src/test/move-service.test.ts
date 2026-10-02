import * as assert from 'assert';

import { MoveBlock, readMoveBlock } from '../domain/markdown/moveLines';
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
    assert.deepStrictEqual(ranks, [[task.id, parseMarkdown('plan.md', fake.text('plan.md') ?? '').tasks[1].id]]);
  });

  test('leaves nothing behind when the settings say so, and previews when every write is', async () => {
    const { fake, history, service } = setup(
      { 'inbox.md': inbox, 'plan.md': plan },
      { 'deckard.moveTo.leaveBehind': 'nothing', 'deckard.previewWorkspaceWrites': 'always' },
    );
    await service.move([{ uri: noteUri('inbox.md'), filePath: 'inbox.md', block: blockAt(inbox, 2) }], {
      uri: noteUri('plan.md'),
      link: 'plan',
      name: 'plan',
    });
    assert.strictEqual(fake.text('inbox.md'), '# Inbox\n- [ ] Call Ren\n');
    assert.strictEqual(history.writes[0].options.preview, 'always');
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
});
