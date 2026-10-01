// The surfaces the layout, visual, and DOM checks draw: each page, the
// snapshot it is drawn from, the size it is drawn at, and what the layout
// check measures on it. They live apart from checkLayout.js, which needs
// Chrome to load, so the checks that read the recorded DOM can name the
// surfaces without it.
// pages.js puts the vscode stand-in in place, which the modules below need.
require('./pages.js');
const modules = require('../harness/modules.js');
const { createTaskBoard } = modules.taskBoardState;
const { createSidebarSnapshot } = modules.relatedNotesRanking;
const { createSearchPageSnapshot, createDeckardStatsSnapshot } = modules.dashboardState;
const { createCalendar } = modules.calendarState;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexer;
const { createPreferences } = modules.preferenceServices;
// Every snapshot is built at NOW, so no surface reads the wall clock.
const { createQueryContext } = modules.queryContext;

/** Enough tasks that the busiest column must scroll, and titles that wrap. */
function createIndex(withSteps = false) {
  const long = 'Chase the replicant through the neon market and file the report before the rain';
  const lines = ['# Tasks #project/atlas', ''];
  for (let i = 1; i <= 40; i += 1) {
    lines.push(`- [ ] ${i === 1 ? long : `Overdue task ${i}`} 📅 2026-09-01 #status/doing`);
    // The board's cards: the long first task has steps, the next of them
    // too long for a column, so its line must ellipsize, not widen the card.
    if (i === 1 && withSteps) {
      lines.push('  - [x] Find the market stall', '  - [ ] Draft the report for the precinct before the rain comes back');
    }
  }
  for (let i = 1; i <= 12; i += 1) {
    lines.push(`- [ ] Later task ${i} 📅 2026-12-01`);
  }
  lines.push('- [ ] Undated task @dana', '- [x] Finished task ✅ 2026-09-10');
  const files = new Map([
    ['notes/tasks.md', parseMarkdown('notes/tasks.md', lines.join('\n'))],
    ['notes/atlas.md', parseMarkdown('notes/atlas.md', [
      '# Atlas #project/atlas @dana',
      'A note with a title long enough to wrap in a narrow sidebar, about #topic/replicants and @ren-kade.',
      '## Meeting #meeting/standup',
      'Notes from the standup with @dana.',
    ].join('\n'))],
    ...Array.from({ length: 12 }, (_, i) => [`notes/note-${i}.md`, parseMarkdown(`notes/note-${i}.md`,
      `# Related note ${i} #project/atlas #topic/replicants\nMentions @dana and the Atlas project, entry ${i}.`)]),
  ]);
  return { index: buildWorkspaceIndex(files), files };
}

/**
 * The calendar's own small month, so no other surface's pixels move with it:
 * a crowded day, a day far past due, and a chosen day with more tasks and
 * new notes than the panel lists at once, their titles long.
 */
function createCalendarIndex() {
  const long = 'Chase the replicant through the neon market and file the report';
  const created = new Date(2026, 8, 21, 9).getTime();
  const tasks = [
    ...Array.from({ length: 7 }, (_, i) => `- [ ] ${long} ${i + 1} 📅 2026-09-21`),
    '- [ ] Draft the brief for the whole of the Atlas programme ⏳ 2026-09-21',
    ...Array.from({ length: 12 }, (_, i) => `- [ ] Busy ${i} 📅 2026-09-24`),
    ...Array.from({ length: 11 }, (_, i) => `- [ ] Planned ${i} ⏳ 2026-09-24`),
    '- [ ] Renew the lease 📅 2026-08-03',
    '- [x] Filed the report ✅ 2026-09-21',
  ];
  const files = new Map([
    ['notes/2026-09-21.md', parseMarkdown('notes/2026-09-21.md', `# 2026-09-21\n${tasks.join('\n')}\n`, { createdAt: created, updatedAt: created })],
    ...Array.from({ length: 6 }, (_, i) => {
      const filePath = `projects/a-folder-with-a-long-name/note-${i}.md`;
      return [filePath, parseMarkdown(filePath, `# A new note with a title too long for the sidebar ${i}\n`, { createdAt: created + i, updatedAt: created })];
    }),
  ]);
  return buildWorkspaceIndex(files);
}

/**
 * The calendar page's month: the sidebar's, with a task due every week that
 * repeats, a task due every day, and a crowded day for +N more.
 */
function createCalendarPageIndex() {
  const base = createCalendarIndex();
  const files = new Map(base.files);
  const created = new Date(2026, 8, 1, 9).getTime();
  files.set('notes/routines.md', parseMarkdown('notes/routines.md', [
    '# Routines',
    '- [ ] Water the plants on the balcony and the ones by the window 📅 2026-09-22 🔁 every week',
    '- [ ] Stand-up 📅 2026-09-21 🔁 every weekday',
    '- [ ] Pay rent 📅 2026-09-28 🔁 every month when done',
  ].join('\n') + '\n', { createdAt: created, updatedAt: created }));
  return buildWorkspaceIndex(files);
}

function createGlobalState() {
  const store = new Map();
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    keys: () => [...store.keys()],
    update: (key, value) => { store.set(key, value); return Promise.resolve(); },
  };
}

const NOW = new Date(2026, 8, 21, 12).getTime();

/**
 * The surfaces measured, each with the snapshot its page renders from and
 * the geometry it must keep. A probe runs in the page and reports; the
 * expectations here read the report.
 */
function createSurfaces(zen) {
  const { index, files } = createIndex();
  // Only the board's surfaces carry steps, so no other page's pixels move.
  const boardIndex = createIndex(true).index;
  const preferences = createPreferences(createGlobalState());
  return [
    {
      page: 'taskBoard',
      viewport: [1400, 900],
      snapshot: () => createTaskBoard({
        index: boardIndex,
        preferences: preferences.reader.value,
        search: { query: '' },
        options: { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing', 'done'], statusNamespace: 'status', format: 'emoji' },
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    },
    {
      // Grouped by a tag namespace, the switch has five segments: it must
      // wrap rather than push the page sideways at a narrower width.
      name: 'taskBoardByTag',
      page: 'taskBoard',
      viewport: [900, 700],
      snapshot: () => createTaskBoard({
        index: boardIndex,
        preferences: { ...preferences.reader.value, taskBoardGroup: 'tag', taskBoardGroupNamespace: 'project' },
        search: { query: '' },
        options: { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing', 'done'], statusNamespace: 'status', format: 'emoji' },
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['html', '.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    },
    {
      // The calendar in a narrow sidebar with its day panel on: counts that
      // run to two digits, and rows whose words are longer than the panel.
      page: 'calendar',
      viewport: [240, 700],
      snapshot: () => createCalendar(createCalendarIndex(), '2026-09', createQueryContext(NOW), {
        dayPanel: true,
      }),
      scrollers: ['html'],
      clippers: ['.day', '.day-panel .task-row'],
      hovered: ['.day-panel .task-row'],
    },
    {
      // The sidebar calendar as its five working days.
      name: 'calendarNoWeekends',
      page: 'calendar',
      viewport: [240, 700],
      snapshot: () => createCalendar(createCalendarIndex(), '2026-09', createQueryContext(NOW), {
        dayPanel: true,
        showWeekends: false,
        selectedDate: '2026-09-24',
      }),
      scrollers: ['html'],
      clippers: ['.day', '.day-panel .task-row'],
      hovered: ['.day-panel .task-row'],
    },
    {
      // Related Notes showing the calendar page's chosen day.
      name: 'sidebarNotesCalendarDay',
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => ({
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: 'inline',
        calendarDay: createCalendar(createCalendarPageIndex(), '2026-09', createQueryContext(NOW), {
          dayPanel: true,
          showRepeats: true,
          selectedDate: '2026-09-24',
        }).selected,
        state: 'calendarDay',
      }),
      scrollers: ['html'],
      clippers: ['.day-panel .task-row'],
      hovered: ['.day-panel .task-row'],
    },
    {
      // The calendar page, wide: the month beside the chosen day, with
      // chips cut short, +N more, and repeats every weekday.
      page: 'calendarPage',
      viewport: [1400, 900],
      snapshot: () => createCalendar(createCalendarPageIndex(), '2026-09', createQueryContext(NOW), {
        dayPanel: true,
        layout: 'page',
        showRepeats: true,
        selectedDate: '2026-09-24',
      }),
      scrollers: ['html'],
      clippers: ['.cal-chip', '.day-panel .task-row'],
      hovered: ['.cal-chip'],
    },
    {
      // The page under 900px: the day panel moves under the month.
      name: 'calendarPageNarrow',
      page: 'calendarPage',
      viewport: [800, 900],
      snapshot: () => createCalendar(createCalendarPageIndex(), '2026-09', createQueryContext(NOW), {
        dayPanel: true,
        layout: 'page',
        showRepeats: true,
      }),
      scrollers: ['html'],
      clippers: ['.cal-chip', '.day-panel .task-row'],
      hovered: ['.cal-chip'],
    },
    {
      // As narrow as a reader is likely to drag the sidebar: the page's own
      // floor is 220px.
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => createSidebarSnapshot(index, 'notes/atlas.md', files.get('notes/atlas.md'), {
        now: NOW,
        enableKeywordLinks: true,
        relatedNotesSortMode: 'tags',
        sectionAccessCounts: {},
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note'],
    },
    {
      // A note with no tags: the tags similar notes use, each a full-width
      // row, then the entries worded like it, at the same narrow width.
      name: 'sidebarNotesUntagged',
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => {
        const untaggedFiles = new Map(files);
        const untagged = parseMarkdown('notes/untagged.md', [
          '# Thursday',
          'Walked the neon market with Dana about the Atlas project and the replicants report.',
          'The related note on the Atlas project needs an entry before the rain.',
        ].join('\n'));
        untaggedFiles.set('notes/untagged.md', untagged);
        return {
          ...createSidebarSnapshot(buildWorkspaceIndex(untaggedFiles), 'notes/untagged.md', untagged, {
            now: NOW,
            enableKeywordLinks: true,
            relatedNotesSortMode: 'tags',
            sectionAccessCounts: {},
            tagTitleDisplayMode: 'inline',
          }),
          previewLines: 1,
        };
      },
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note'],
    },
    // Zen folds each card's file and line away and reveals it on hover, so a
    // hovered result is the one row that grows. The search page is where that
    // reveal sits inside a .card-header rather than at the end of the row.
    // Without zen it is drawn too, so its cards' tags, their three lines, and
    // the hub line are measured in every theme.
    {
      // Stats: what needs attention first, then the totals, then what is
      // viewed most, with every panel's rows at full width.
      page: 'stats',
      viewport: [1100, 900],
      snapshot: () => ({
        ...createDeckardStatsSnapshot(index, {
          ...preferences.reader.value,
          tagAccessCounts: { '#project/atlas': 4, '#topic/replicants': 2 },
        }, [{ filePath: 'notes/unreadable-note-with-a-long-name.md', reason: 'EACCES: permission denied' }], NOW),
        // "5 minutes ago" would change with the clock, and so the pixels.
        updatedAt: 0,
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.metric-open'],
    },
    {
      page: 'searchPage',
      viewport: [900, 900],
      snapshot: () => createSearchPageSnapshot(index, preferences.reader.value, '#project/atlas', {
        queryContext: createQueryContext(NOW),
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.card'],
    },
  ];
}

module.exports = { createSurfaces, NOW };
