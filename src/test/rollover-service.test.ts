import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { planRollover, RolloverPlan } from '../domain/notes/rolloverPlan';
import type { ResourceUri } from '../ports/uri';
import {
  PlaceCarriedOver,
  RolloverEdit,
  RolloverNotes,
  RolloverService,
  RolloverSource,
  RolloverWriteOutcome,
} from '../services/rolloverService';
import { fileUri } from './fakeWorkspace';

// RolloverService decides what a rollover carries and what it changes in
// the notes the tasks came from; these run it over notes held in memory and
// a write that records each change, so every outcome is a value to assert.

const TODAY = fileUri('/ws/notes/2026-09-19.md');

/** An index of the notes, by path, as the scanner would build it. */
function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

/** Notes in memory, and every write asked of them. */
class FakeNotes implements RolloverNotes<ResourceUri, string> {
  public readonly writes: { edits: readonly RolloverEdit<ResourceUri>[]; carried: number }[] = [];
  public applied = true;

  public constructor(
    public readonly texts: Map<string, string>,
    public today: string,
  ) {}

  public readToday(): Promise<string> {
    return Promise.resolve(this.today);
  }

  public openSource(filePath: string): Promise<RolloverSource<ResourceUri> | undefined> {
    const text = this.texts.get(filePath);
    return Promise.resolve(
      text === undefined ? undefined : { uri: fileUri(`/ws/${filePath}`), text: () => this.texts.get(filePath) ?? '' },
    );
  }

  public write(edits: readonly RolloverEdit<ResourceUri>[], carried: number): Promise<RolloverWriteOutcome<string>> {
    this.writes.push({ edits, carried });
    return Promise.resolve(this.applied ? { applied: true, handle: 'handle' } : { applied: false });
  }
}

/** Where the carried lines go: appended at the end of today's note, which is all these tests need. */
const appendAtEnd: PlaceCarriedOver = (content, lines) => {
  const noteLines = content.split('\n');
  const end = { line: noteLines.length - 1, character: noteLines[noteLines.length - 1].length };
  return { start: end, end, text: lines.join('\n') };
};

/** A service over the fakes, with a clock held at noon on 2026-09-19. */
function rolloverWith(notes: FakeNotes, refresh: () => Promise<void> = () => Promise.resolve()) {
  let refreshes = 0;
  const service = new RolloverService<ResourceUri, string>({
    notes,
    place: appendAtEnd,
    index: {
      refresh: () => {
        refreshes += 1;
        return refresh();
      },
    },
    clock: { now: () => new Date(2026, 8, 19, 12).getTime() },
  });
  return { service, refreshes: () => refreshes };
}

const yesterday = [
  '# 2026-09-18',
  '',
  '- [ ] Chase the contractor',
  '  - [x] Call once',
  '  - [ ] Get the survey back',
  '- [x] Filed the report',
  '- [ ] Book travel',
].join('\n');
const FROM = 'notes/2026-09-18.md';

/** The plan for yesterday's note as written. */
function planOf(text = yesterday, mode: 'move' | 'migrate' = 'move'): RolloverPlan {
  const plan = planRollover(indexOf({ [FROM]: text }), '2026-09-19', 0, mode);
  assert.ok(plan, 'there is something to carry');
  return plan;
}

suite('RolloverService', () => {
  test('moves each task with everything under it, and takes the block out of its note', async () => {
    const notes = new FakeNotes(new Map([[FROM, yesterday]]), '# 2026-09-19\n');
    const { service } = rolloverWith(notes);

    const result = await service.apply({ plan: planOf(), todayUri: TODAY, mode: 'move' });

    assert.deepStrictEqual(result, {
      kind: 'carried',
      carried: 3,
      skipped: 0,
      fromDates: ['2026-09-18'],
      notes: 1,
      handle: 'handle',
    });
    const [write] = notes.writes;
    assert.strictEqual(write.carried, 3);
    assert.deepStrictEqual(
      write.edits.map((edit) => [edit.uri.path, edit.range, edit.text]),
      [
        [
          TODAY.path,
          { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
          '- [ ] Chase the contractor\n  - [x] Call once\n  - [ ] Get the survey back\n- [ ] Book travel',
        ],
        ['/ws/notes/2026-09-18.md', { start: { line: 2, character: 0 }, end: { line: 5, character: 0 } }, ''],
        ['/ws/notes/2026-09-18.md', { start: { line: 5, character: 22 }, end: { line: 6, character: 17 } }, ''],
      ],
    );
  });

  test('takes tasks that end a note with no final line break out as one stretch', async () => {
    const ending = '# 2026-09-18\n\n- [ ] Call Ren\n- [ ] Pay rent';
    const notes = new FakeNotes(new Map([[FROM, ending]]), '# 2026-09-19\n');
    const { service } = rolloverWith(notes);

    const result = await service.apply({ plan: planOf(ending), todayUri: TODAY, mode: 'move' });

    assert.strictEqual(result.kind, 'carried');
    // Two stretches would overlap on the break between the tasks, which the
    // first takes after it and the last, ending the note, before it.
    assert.deepStrictEqual(
      notes.writes[0].edits.slice(1).map((edit) => [edit.uri.path, edit.range, edit.text]),
      [['/ws/notes/2026-09-18.md', { start: { line: 1, character: 0 }, end: { line: 3, character: 14 } }, '']],
    );
  });

  test('migrates the open steps, and marks each line it leaves behind with a link to today', async () => {
    const notes = new FakeNotes(new Map([[FROM, yesterday]]), '# 2026-09-19\n');
    const { service } = rolloverWith(notes);

    // `copy` is the older name for a migrate.
    const result = await service.apply({ plan: planOf(yesterday, 'migrate'), todayUri: TODAY, mode: 'copy', todayName: 'Today' });

    assert.strictEqual(result.kind, 'carried');
    const [today, ...marks] = notes.writes[0].edits;
    assert.strictEqual(today.text, '- [ ] Chase the contractor\n  - [ ] Get the survey back\n- [ ] Book travel');
    assert.deepStrictEqual(
      marks.map((edit) => [edit.range.start.line, edit.text]),
      [
        [2, '- [>] Chase the contractor → [[Today]]'],
        [4, '  - [>] Get the survey back → [[Today]]'],
        [6, '- [>] Book travel → [[Today]]'],
      ],
    );
  });

  test('leaves what today already holds, what changed since indexing, and what cannot be read', async () => {
    const changed = yesterday.replace('- [ ] Book travel', '- [ ] Book travel, edited');
    const notes = new FakeNotes(new Map([[FROM, changed]]), '# 2026-09-19\n\n- [ ] Chase the contractor\n');
    const { service } = rolloverWith(notes);

    assert.deepStrictEqual(await service.apply({ plan: planOf(), todayUri: TODAY, mode: 'move' }), {
      kind: 'nothing-carried',
      skipped: 3,
      fromDates: ['2026-09-18'],
    });
    assert.strictEqual(notes.writes.length, 0);

    const unread = new FakeNotes(new Map(), '# 2026-09-19\n');
    assert.deepStrictEqual(await rolloverWith(unread).service.apply({ plan: planOf(), todayUri: TODAY, mode: 'move' }), {
      kind: 'nothing-carried',
      skipped: 3,
      fromDates: ['2026-09-18'],
    });
  });

  test('reports a write VS Code did not apply', async () => {
    const notes = new FakeNotes(new Map([[FROM, yesterday]]), '# 2026-09-19\n');
    notes.applied = false;
    assert.deepStrictEqual(await rolloverWith(notes).service.apply({ plan: planOf(), todayUri: TODAY, mode: 'move' }), {
      kind: 'not-applied',
    });
  });

  test('rolls forward from the index, creating today only when there is something to carry', async () => {
    const notes = new FakeNotes(new Map([[FROM, yesterday]]), '# 2026-09-19\n');
    const { service, refreshes } = rolloverWith(notes);
    let created = 0;
    const ensureToday = () => {
      created += 1;
      return Promise.resolve(TODAY);
    };

    const nothing = await service.rollForward({
      index: indexOf({ [FROM]: '# 2026-09-18\n\n- [x] Done\n' }),
      mode: 'move',
      lookbackDays: 7,
      ensureToday,
    });
    assert.deepStrictEqual(nothing, { kind: 'nothing-waiting' });
    assert.strictEqual(created, 0);

    const rolled = await service.rollForward({ index: indexOf({ [FROM]: yesterday }), mode: 'migrate', lookbackDays: 7, ensureToday });
    assert.strictEqual(rolled.kind, 'carried');
    assert.strictEqual(rolled.kind === 'carried' && rolled.todayUri, TODAY);
    assert.strictEqual(created, 1);
    assert.strictEqual(refreshes(), 1);
    // The migrated line links to today's note by its file's name.
    assert.ok(notes.writes[0].edits.some((edit) => edit.text.endsWith('→ [[2026-09-19]]')));
  });

  test('still reports what it carried when the notes cannot be read again', async () => {
    const notes = new FakeNotes(new Map([[FROM, yesterday]]), '# 2026-09-19\n');
    const { service } = rolloverWith(notes, () => Promise.reject(new Error('index busy')));
    const result = await service.rollForward({
      index: indexOf({ [FROM]: yesterday }),
      mode: 'move',
      lookbackDays: 0,
      ensureToday: () => Promise.resolve(TODAY),
    });
    assert.strictEqual(result.kind, 'carried');
  });

  test('does not read the notes again when the write was not applied', async () => {
    const notes = new FakeNotes(new Map([[FROM, yesterday]]), '# 2026-09-19\n');
    notes.applied = false;
    const { service, refreshes } = rolloverWith(notes);
    const result = await service.rollForward({
      index: indexOf({ [FROM]: yesterday }),
      mode: 'move',
      lookbackDays: 0,
      ensureToday: () => Promise.resolve(TODAY),
    });
    assert.deepStrictEqual(result, { kind: 'not-applied' });
    assert.strictEqual(refreshes(), 0);
  });
});
