import * as assert from 'assert';

import { TAG_VISIT_LIMIT, TAG_VISIT_PREFIX, TAG_VISITS_KEY, TagVisits } from '../core/storage/tagVisits';
import { DAY_MS } from '../domain/markdown/calendar';
import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { HubNewsReader, type HubVisits } from '../ui/state/hubNews';
import { buildHubTree, type HubTreeNode } from '../ui/state/hubTree';
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

  test('counts the questions answered since, whose chip narrows the Questions tab to them, and a visit kept before questions counts none', () => {
    const asked = (...rows: string[]) => indexOf({ ...THEN, 'notes/asks.md': lines('# Asks #team/rates', ...rows) });
    const then = asked('- [?] Who owns the curve feed?', '- [?] Where is the runbook?', '  - Answer: in the wiki', '- [?] When is the freeze?');
    const visit = toTagVisit(captureTagPageState(then, '#team/rates', createQueryContext(before)), before);
    const index = asked(
      'A line written above them.',
      '- [?] Who owns the curve feed?',
      '  - Answer: Sam, from Monday',
      '- [?] Where is the runbook?',
      '  - Answer: in the wiki',
      '- [?] When is the freeze?',
    );
    const changes = compareTagPage(visit, captureTagPageState(index, '#team/rates', context));
    assert.strictEqual(changes.answeredQuestions.size, 1, 'the one answered since, though its line moved; not the one answered before');
    const page = pageWith(index, '#team/rates', { visit });
    assert.ok(page.since?.chips.some((chip) => chip.kind === 'answered' && chip.label === '1 question answered'));
    assert.strictEqual(page.questions?.length, 3, 'unfiltered, the tab lists every question');
    const answered = pageWith(index, '#team/rates', { visit, filter: 'answered' });
    assert.deepStrictEqual(answered.questions?.map((question) => question.text), ['Who owns the curve feed?']);
    assert.strictEqual(answered.since?.chips.find((chip) => chip.active)?.kind, 'answered');
    assert.strictEqual(answered.tasks.length, page.tasks.length, 'the tasks are left as they are');
    const { answered: _none, ...older } = visit;
    assert.strictEqual(compareTagPage(older, captureTagPageState(index, '#team/rates', context)).answeredQuestions.size, 0);
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

  test('the Hubs view says what is new under each hub, when each was seen, and sorts by What’s new', async () => {
    const index = indexOf({
      ...NOW,
      'Teams/FX.md': lines('---', 'describes: team/fx', '---', '# FX desk'),
      'Teams/Credit.md': lines('---', 'describes: team/credit', '---', '# Credit desk'),
      'notes/fx.md': lines('# FX notes #team/fx', 'Fixings.'),
    });
    const visits = new TagVisits(new MemoryStore());
    await visits.record('#team/rates', visitThen());
    await visits.record('#team/fx', toTagVisit(captureTagPageState(index, '#team/fx', context), now - 60_000));
    const reader = await readHubNews(index, visits);
    const hubs = (): HubTreeNode[] => buildHubTree(index, now, reader.news(index, context))[0].children;
    assert.deepStrictEqual(hubs().map((hub) => [hub.label, hub.description]), [
      ['Credit desk', 'never opened'],
      ['FX desk', 'seen today'],
      ['Rates desk', '5 new · 1/3 done (33%)'],
    ]);
    await visits.setHubSort('new');
    assert.deepStrictEqual(hubs().map((hub) => hub.label), ['Rates desk', 'Credit desk', 'FX desk']);
    const seenEarlier = new TagVisits(new MemoryStore());
    await seenEarlier.record('#team/fx', toTagVisit(captureTagPageState(index, '#team/fx', context), before));
    const earlier = await readHubNews(index, seenEarlier);
    const fx = buildHubTree(index, now, earlier.news(index, context))[0].children.find((hub) => hub.label === 'FX desk');
    assert.match(fx?.description ?? '', /^seen /);
    assert.doesNotMatch(fx?.description ?? '', /today|new/, 'nothing new since a visit long ago says when it was');
  });

  test('the Hubs view draws at once and counts what is new after, quickly for 150 visited hubs over 6,000 notes', async () => {
    const HUBS = 150;
    const notes: Record<string, string> = {};
    for (let hub = 0; hub < HUBS; hub += 1) {
      notes[`Teams/T${hub}.md`] = lines('---', `describes: team/t${hub}`, '---', `# Team ${hub}`);
    }
    for (let note = 0; note < 6000; note += 1) {
      const tag = `#team/t${note % HUBS}`;
      notes[`notes/n${note}.md`] = lines(`# Note ${note} ${tag}`, 'Some words about the work.', `- [ ] Do the thing ${note} ${tag}`, '## Part', 'More words.');
    }
    const then = indexOf(notes);
    const visits = new TagVisits(new MemoryStore());
    for (let hub = 0; hub < HUBS; hub += 1) {
      await visits.record(`#team/t${hub}`, toTagVisit(captureTagPageState(then, `#team/t${hub}`, context), before));
    }
    const index = indexOf({ ...notes, 'notes/new.md': lines('# New #team/t7', 'Since.') });

    let ready = (): void => undefined;
    const counted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const reader = new HubNewsReader(visits, () => ready(), 0);
    let start = Date.now();
    const first = buildHubTree(index, now, reader.news(index, context))[0].children;
    const draw = Date.now() - start;
    assert.ok(first.every((hub) => /^seen /.test(hub.description ?? '')), 'the first draw says when each hub was seen');
    start = Date.now();
    await counted;
    const count = Date.now() - start;
    const after = buildHubTree(index, now, reader.news(index, context))[0].children;
    assert.deepStrictEqual(
      after.filter((hub) => /new/.test(hub.description ?? '')).map((hub) => [hub.label, hub.description?.replace(/ ·.*/, '')]),
      [['Team 7', '1 new']],
    );
    // Before, each draw searched the workspace once a hub: some 13 s here.
    assert.ok(draw < 1000, `the tree drew in ${draw} ms`);
    assert.ok(count < 5000, `the hubs were counted in ${count} ms`);
    reader.dispose();
  });
});

/** The hubs' news read through `visits`, once every hub of `index` is counted. */
async function readHubNews(index: WorkspaceIndex, visits: HubVisits): Promise<HubNewsReader> {
  let ready = (): void => undefined;
  const counted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const reader = new HubNewsReader(visits, () => ready(), 0);
  buildHubTree(index, now, reader.news(index, context));
  // A tree whose hubs were all seen within the day has nothing to count.
  await Promise.race([counted, new Promise((resolve) => setTimeout(resolve, 50))]);
  return reader;
}
