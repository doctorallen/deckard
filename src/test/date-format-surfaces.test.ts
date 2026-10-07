import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { DEFAULT_DATE_FORMATS, type DateFormats } from '../domain/markdown/dateFormat';
import { createQueryContext } from '../domain/query/queryContext';
import { createAgenda } from '../ui/state/agendaState';
import { createCalendarDay } from '../ui/state/calendarState';
import { createDashboardTask } from '../ui/state/entryCards';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * A date format of the reader's own, as the host words dates with it and a
 * page draws them: board cards and their parts, the Tasks view's day
 * headings and reasons, the calendar's day title, and a row's due date.
 */
suite('Dates in the reader\'s format', () => {
  let page: WebviewPage | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  // Monday 2026-09-21, noon.
  const NOW = new Date(2026, 8, 21, 12).getTime();
  const FORMATS: DateFormats = { ...DEFAULT_DATE_FORMATS, date: 'D MMM YYYY', short: 'ddd D MMM' };
  const context = createQueryContext(NOW, { dateFormats: FORMATS });
  const NOTE = [
    '# Atlas',
    '- [ ] Send the proposal 📅 2026-09-18 ⏳ 2026-09-17',
    '- [ ] Book the venue 📅 2026-09-24',
    '- [x] Draft the brief ✅ 2026-09-15',
  ].join('\n');
  const index = buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', NOTE)]]));

  /** The board the host would send, every card in one place. */
  const board = () => {
    const store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    try {
      return createTaskBoard({
        index,
        preferences: { ...store.reader.value, taskBoardLayout: 'board' },
        search: { query: '' },
        options: { queryContext: context, statuses: ['todo', 'doing'], format: 'emoji', showDone: true } as never,
      });
    } finally {
      store.repository.dispose();
    }
  };
  const cardOf = (snapshot: ReturnType<typeof board>, title: string) =>
    snapshot.columns.flatMap((column) => column.cards).find((card) => card.title === title);

  test('a board card words its dates in the format, and gives their parts', () => {
    const card = cardOf(board(), 'Send the proposal');
    assert.deepStrictEqual(card?.details, ['overdue 3 days · 18 Sep 2026', 'scheduled 17 Sep 2026']);
    assert.deepStrictEqual(card?.detailParts, [
      { index: 0, date: '18 Sep 2026', due: { state: 'overdue', distance: ' 3 days', date: '18 Sep 2026' }, tone: 'overdue' },
      { index: 1, date: '17 Sep 2026' },
    ]);
  });

  test('the board page draws each date whole from its parts, with no shape to read', () => {
    page = openWebviewPage(renderPage('taskBoard', { chrome: { theme: 'cooper', zen: false, display: { dateFormat: 'D MMM YYYY' } } }), board());
    const card = page.findAll('.board-card').find((each) => each.textContent?.includes('Send the proposal'));
    const dates = [...(card?.querySelectorAll('.board-date') ?? [])].map((date) => date.textContent);
    assert.deepStrictEqual(dates, ['18 Sep 2026', '17 Sep 2026']);
    assert.strictEqual(card?.querySelector('.board-details .overdue .due-distance')?.textContent, ' 3 days');
  });

  test('the Tasks view heads a day in the short format and gives its reasons in the full one', () => {
    const groups = createAgenda(index, context, { upcomingDays: 7, upcomingByDay: true });
    assert.deepStrictEqual(groups.map((group) => group.label).filter((label) => /Sep/.test(label)), ['Thu 24 Sep']);
    const overdue = groups.find((group) => group.id === 'overdue');
    assert.strictEqual(overdue?.entries[0].details[0], 'due Fri 18 Sep 2026');
  });

  test('a format that names the weekday is written alone, so the day is not named twice', () => {
    const named = createQueryContext(NOW, { dateFormats: { ...DEFAULT_DATE_FORMATS, date: 'dddd D MMMM' } });
    const overdue = createAgenda(index, named, { upcomingDays: 7 }).find((group) => group.id === 'overdue');
    assert.strictEqual(overdue?.entries[0].details[0], 'due Friday 18 September');
  });

  test('the calendar titles a day in the short format, and one in another year in full', () => {
    assert.strictEqual(createCalendarDay(index, '2026-09-24', context).title, 'Thu 24 Sep');
    assert.strictEqual(createCalendarDay(index, '2027-09-24', context).title, '24 Sep 2027');
  });

  test('a row gives its due date in parts, in the format', () => {
    const task = [...index.tasks.values()].find((each) => each.title.startsWith('Book'));
    const row = task && createDashboardTask(task, index.sections, context);
    assert.strictEqual(row?.dueLabel, 'Due in 3 days · 24 Sep 2026');
    assert.deepStrictEqual(row?.dueParts, { state: 'Due', distance: ' in 3 days', date: '24 Sep 2026' });
  });
});
