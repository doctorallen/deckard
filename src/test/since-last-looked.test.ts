import * as assert from 'assert';

import { TAG_VISIT_LIMIT, TAG_VISIT_PREFIX, TAG_VISITS_KEY, TagVisits } from '../core/storage/tagVisits';
import { DAY_MS } from '../domain/markdown/calendar';
import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { captureTagPageState, createSearchPageSnapshot } from '../ui/state/searchPageState';
import { compareTagPage, isSinceShown, toTagVisit } from '../ui/state/sinceLastLooked';
import { createPreferences, MemoryStore } from './preferenceServices';
import { indexOf } from './typedWorkspace';

const lines = (...text: string[]): string => text.join('\n');

/** Now: 14 Oct 2026, noon; the last visit was twelve days before. */
const now = new Date(2026, 9, 14, 12).getTime();
const before = now - 12 * DAY_MS;
const context = createQueryContext(now);

/** The Rates team's notes when the reader last looked: its hub, a standup, and two tasks. */
const THEN: Record<string, string> = {
  'Teams/Rates.md': lines('---', 'describes: team/rates', 'lead: "@alex-rivera"', 'channel: rates-desk', '---', '# Rates desk'),
  'notes/2026-10-01.md': lines(
    '# 2026-10-01',
    '## Rates standup #team/rates',
    'The curve feed lagged.',
    '- [ ] Ask Ops about the loader #team/rates',
    '- [ ] Review the UST pricing #team/rates',
  ),
  'notes/handover.md': lines('# Handover #team/rates', 'Nothing yet.'),
};

/**
 * The same notes now: a line above the standup moves it, the handover is
 * rewritten, a new standup is written, the lead changed, one task is done
 * and one is added.
 */
const NOW: Record<string, string> = {
  'Teams/Rates.md': lines('---', 'describes: team/rates', 'lead: "@sam-okafor"', 'channel: rates-desk', '---', '# Rates desk'),
  'notes/2026-10-01.md': lines(
    '# 2026-10-01',
    'A line written above, which moves every line under it.',
    '## Rates standup #team/rates',
    'The curve feed lagged.',
    '- [x] Ask Ops about the loader #team/rates ✅ 2026-10-09',
    '- [ ] Review the UST pricing #team/rates',
    '- [ ] Book the loader restart window #team/rates',
  ),
  'notes/handover.md': lines('# Handover #team/rates', 'Alex moves to FX; Sam leads Rates from Monday.'),
  'notes/2026-10-14.md': lines('# 2026-10-14', '## Rates standup again #team/rates', 'Stale yields for ten minutes.'),
};

/** The visit the reader made, as the page held it then. */
function visitThen(at = before) {
  return toTagVisit(captureTagPageState(indexOf(THEN), '#team/rates', createQueryContext(at)), at);
}

/** A search page for a search, compared with a visit. */
function pageWith(index: WorkspaceIndex, query: string, since: Parameters<typeof createSearchPageSnapshot>[3]['since']) {
  return createSearchPageSnapshot(index, createPreferences(new MemoryStore()).reader.value, query, { queryContext: context, since });
}

suite('Since you last looked', () => {
  test('counts the entries written or changed, the fields changed, and the tasks done and added, and nothing for a line that only moved', () => {
    const changes = compareTagPage(visitThen(), captureTagPageState(indexOf(NOW), '#team/rates', context));
    assert.strictEqual(changes.newEntries.size, 2, 'the rewritten handover and the new standup; the standup that moved is the same entry');
    assert.deepStrictEqual(changes.was, { lead: '@alex-rivera' });
    assert.strictEqual(changes.fieldsChanged, 1);
    assert.strictEqual(changes.doneTasks.size, 1, 'done, though its line moved and its done date was written');
    assert.strictEqual(changes.addedTasks.size, 1);
    assert.strictEqual(changes.total, 5);
  });

  test('a task added and done since counts as done, and a field taken away counts as changed with nothing to show', () => {
    const visit = visitThen();
    const next = indexOf({
      ...THEN,
      'Teams/Rates.md': lines('---', 'describes: team/rates', 'lead: "@alex-rivera"', '---', '# Rates desk'),
      'notes/more.md': lines('# More #team/rates', '- [x] Done at once #team/rates'),
    });
    const changes = compareTagPage(visit, captureTagPageState(next, '#team/rates', context));
    assert.strictEqual(changes.doneTasks.size, 1);
    assert.strictEqual(changes.addedTasks.size, 0);
    assert.strictEqual(changes.fieldsChanged, 1);
    assert.deepStrictEqual(changes.was, {}, 'the channel is gone, so no row shows what it was');
  });

  test('shows the band only when something changed and the last visit was over a day ago', () => {
    const same = compareTagPage(visitThen(), captureTagPageState(indexOf(THEN), '#team/rates', context));
    assert.strictEqual(isSinceShown(same, now), false, 'nothing changed');
    const recent = compareTagPage(visitThen(now - DAY_MS + 60_000), captureTagPageState(indexOf(NOW), '#team/rates', context));
    assert.strictEqual(isSinceShown(recent, now), false, 'seen within the day');
    const old = compareTagPage(visitThen(now - DAY_MS - 60_000), captureTagPageState(indexOf(NOW), '#team/rates', context));
    assert.strictEqual(isSinceShown(old, now), true);
    assert.strictEqual(pageWith(indexOf(NOW), '#team/rates', { visit: visitThen(now - DAY_MS + 60_000) }).since, undefined);
    assert.strictEqual(pageWith(indexOf(NOW), '#team/rates', { visit: undefined }).since, undefined, 'a first visit draws no band');
  });

  test('the page draws the band, its chips, the new notes first and marked, the added task marked, and the field’s old value', () => {
    const page = pageWith(indexOf(NOW), '#team/rates', { visit: visitThen() });
    assert.ok(page.since);
    assert.match(page.since.when, /, 12 days ago$/);
    assert.deepStrictEqual(page.since.chips.map((chip) => chip.label), ['2 new mentions', '1 field changed', '1 task done', '1 task added']);
    assert.deepStrictEqual(page.since.was, { lead: '@alex-rivera' });
    assert.strictEqual(page.since.newNotes, 2);
    assert.deepStrictEqual(page.sections.map((card) => [card.heading, card.isNew === true]), [
      ['Handover #team/rates', true],
      ['Rates standup again #team/rates', true],
      ['Rates standup #team/rates', false],
    ]);
    assert.deepStrictEqual(page.tasks.filter((item) => item.isNew).map((item) => item.task.title.trim()), ['Book the loader restart window #team/rates']);
  });

  test('a chip narrows the notes or the tasks to what it counts, and marks itself', () => {
    const visit = visitThen();
    const mentions = pageWith(indexOf(NOW), '#team/rates', { visit, filter: 'mentions' });
    assert.deepStrictEqual(mentions.sections.map((card) => card.heading), ['Handover #team/rates', 'Rates standup again #team/rates']);
    assert.strictEqual(mentions.notePaging.total, 2);
    assert.strictEqual(mentions.since?.chips.find((chip) => chip.active)?.kind, 'mentions');
    const done = pageWith(indexOf(NOW), '#team/rates', { visit, filter: 'done' });
    assert.deepStrictEqual(done.tasks.map((item) => item.task.title.trim()), ['Ask Ops about the loader #team/rates']);
    const added = pageWith(indexOf(NOW), '#team/rates', { visit, filter: 'added' });
    assert.deepStrictEqual(added.tasks.map((item) => item.task.title.trim()), ['Book the loader restart window #team/rates']);
  });

  test('a search that narrows the tag, or is no tag’s, draws no band and marks nothing', () => {
    const visit = visitThen();
    const narrowed = pageWith(indexOf(NOW), '#team/rates is:open', { visit });
    assert.strictEqual(narrowed.since, undefined);
    assert.ok(narrowed.tasks.every((item) => !item.isNew));
    assert.strictEqual(pageWith(indexOf(NOW), 'curve', { visit }).since, undefined);
  });

  test('keeps one visit a tag, replaced each time, drops a gone tag’s, and keeps at most 500, the oldest going first', async () => {
    const store = new MemoryStore();
    const visits = new TagVisits(store);
    const visit = visitThen();
    await visits.record('#team/rates', visit);
    assert.deepStrictEqual(visits.get('#team/rates'), visit);
    await visits.record('#team/rates', { ...visit, seenAt: now });
    assert.strictEqual(visits.get('#team/rates')?.seenAt, now, 'the last visit replaces the one before');
    await visits.record('#team/fx', { ...visit, seenAt: now }, (key) => key !== '#team/rates');
    assert.strictEqual(visits.get('#team/rates'), undefined, 'a tag the index no longer has loses its visit');
    for (let at = 0; at < TAG_VISIT_LIMIT + 2; at += 1) {
      await visits.record(`#t/${at}`, { ...visit, seenAt: before + at });
    }
    const kept = visits.seenAt();
    assert.strictEqual(kept.size, TAG_VISIT_LIMIT);
    assert.ok(!kept.has('#t/0') && !kept.has('#t/1'), 'the oldest went first');
    assert.ok(kept.has('#team/fx'), 'a later visit stays');
    assert.strictEqual(store.get(`${TAG_VISIT_PREFIX}#t/0`), undefined);
    assert.ok(kept.has(`#t/${TAG_VISIT_LIMIT + 1}`));
  });

  test('reads a stored value that is no visit as none', async () => {
    const store = new MemoryStore();
    await store.update(`${TAG_VISIT_PREFIX}#a`, { seenAt: 'yesterday', entries: {}, tasks: { open: [], done: [] }, fields: {} });
    await store.update(`${TAG_VISIT_PREFIX}#b`, { seenAt: now, entries: {}, tasks: { open: [1], done: [] }, fields: {} });
    await store.update(TAG_VISITS_KEY, { '#a': 'soon', '#b': now });
    const visits = new TagVisits(store);
    assert.strictEqual(visits.get('#a'), undefined);
    assert.strictEqual(visits.get('#b'), undefined);
    assert.deepStrictEqual([...visits.seenAt()], [['#b', now]]);
    assert.strictEqual(visits.hubSort(), 'name');
  });
});
