// The surfaces the layout, visual, and DOM checks draw: each page, the
// snapshot it is drawn from, the size it is drawn at, and what the layout
// check measures on it. They live apart from checkLayout.js, which needs
// Chrome to load, so the checks that read the recorded DOM can name the
// surfaces without it.
//
// A surface may also name what happens after its state arrives: `messages`
// its host would send next, such as Help's guide page, and `drive`, the
// `[event, selector]` pairs a reader's actions dispatch, such as opening a
// menu; `css` of its own, such as the Notes Graph's hidden canvas; and
// `pageOptions` its page is rendered with, such as the entry the debug page
// diagnoses.
const path = require('node:path');
const { readFileSync } = require('node:fs');
// pages.js puts the vscode stand-in in place, which the modules below need.
const { renderPage } = require('./pages.js');
const modules = require('../harness/modules.js');
const { createTaskBoard } = modules.taskBoardState;
const { createSidebarSnapshot } = modules.relatedNotesRanking;
const { createDashboardSnapshot, createSearchPageSnapshot, createDeckardStatsSnapshot } = modules.dashboardState;
const { createDashboardWidgets } = modules.dashboardWidgets;
const { createNotesGraphSnapshot, toWire } = modules.notesGraphState;
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
 * The Dashboard as the host sends it: Home with its widgets, or the Tags
 * mode, at one moment.
 *
 * @param {object} index The workspace.
 * @param {object} preferences The stored preferences.
 * @param {'home' | 'browse'} mode Home, or the Tags mode.
 * @returns {object} The state message's data.
 */
function createDashboardState(index, preferences, mode) {
  const queryContext = createQueryContext(NOW);
  const viewPreferences = { ...preferences, dashboardViewState: { ...preferences.dashboardViewState, mode } };
  return {
    ...createDashboardSnapshot({ index, preferences: viewPreferences, tagTitleDisplayMode: 'inline', agendaQuery: '', queryContext }),
    homeArranged: false,
    ...(mode === 'home'
      ? { widgets: createDashboardWidgets(index, viewPreferences, { queryContext, upcomingDays: 7, agendaQuery: '', tagTitleDisplayMode: 'inline' }) }
      : {}),
    parkedTags: [],
  };
}

/**
 * The Dashboard's surfaces: Home, the Tags mode, Home being arranged, and
 * Home's search with its builder open. The Dashboard had no surface before
 * Phase 6, so a change to how it looks passed every check.
 *
 * @param {object} index The workspace.
 * @param {object} preferences The stored preferences.
 * @returns {object[]} One surface for each of the four states.
 */
function createDashboardSurfaces(index, preferences) {
  // A driven surface hovers something only the action draws, so the layout
  // check fails, with no row to hover, if the action stops reaching it.
  const dashboard = (name, mode, { drive, hovered }) => ({
    name,
    page: 'dashboard',
    viewport: [1400, 900],
    snapshot: () => createDashboardState(index, preferences, mode),
    ...(drive ? { drive } : {}),
    scrollers: ['html'],
    clippers: [],
    hovered,
  });
  return [
    dashboard('dashboardHome', 'home', { hovered: ['.home-widget .row', '.home-widget'] }),
    dashboard('dashboardTags', 'browse', { hovered: ['.tag-row', '.row'] }),
    dashboard('dashboardArranging', 'home', {
      drive: [['click', '[data-action="customize-home"]']],
      hovered: ['.home-widget.is-editing'],
    }),
    dashboard('dashboardQueryBuilder', 'home', {
      drive: [['click', '.home-widget [data-action="toggle-builder"]']],
      hovered: ['.query-builder-group'],
    }),
  ];
}

/**
 * The guide page the helpGuide surface shows: what Help's host sent for it
 * before Phase 6, captured once from renderGuidePage (markdown-it), so Step 4
 * can compare the page markdown.api.render draws with it.
 */
const GUIDE_FIXTURE = {
  page: 'daily-notes',
  title: 'Daily notes, reviews, and the calendar',
  file: path.join(__dirname, 'fixtures', 'guide-daily-notes.html'),
};

/**
 * The entry the Related Notes debug page diagnoses: the Atlas note, its tags
 * in each context the page tells apart, and the notes ranked for it.
 *
 * @param {object} index The workspace.
 * @param {Map<string, object>} files The parsed notes, by path.
 * @returns {object} What the debug page's host would pass it for that entry.
 */
function createDiagnostic(index, files) {
  return {
    filePath: 'notes/atlas.md',
    sourceLine: 1,
    title: 'Atlas',
    tags: [
      { key: '#project/atlas', weight: 1, context: 'selected', source: 'Written on the selected entry' },
      { key: '#topic/replicants', weight: 0.5, context: 'parent', source: 'Parent ancestry: one level up (0.5 / 1)' },
      { key: '#meeting/standup', weight: 0.25, context: 'child', source: 'Child heading: 2 levels down (0.5 / 2)' },
    ],
    snapshot: createSidebarSnapshot(index, 'notes/atlas.md', files.get('notes/atlas.md'), {
      now: NOW,
      enableKeywordLinks: true,
      relatedNotesSortMode: 'tags',
      sectionAccessCounts: {},
      tagTitleDisplayMode: 'inline',
    }),
  };
}

/**
 * Help, a guide page shown inside it, the Notes Graph's controls, and the
 * Related Notes debug page: the pages that had no surface before Phase 6.
 *
 * @param {object} index The workspace.
 * @param {Map<string, object>} files The parsed notes, by path.
 * @returns {object[]} One surface for each of the four pages.
 */
function createReferenceSurfaces(index, files) {
  const graph = toWire(createNotesGraphSnapshot(index), { notes: true, tasks: true });
  return [
    { page: 'help', viewport: [1100, 900], scrollers: ['html'], clippers: [], hovered: ['nav a'] },
    {
      name: 'helpGuide',
      page: 'help',
      viewport: [1100, 900],
      messages: () => [{ type: 'guide', page: GUIDE_FIXTURE.page, title: GUIDE_FIXTURE.title, html: readFileSync(GUIDE_FIXTURE.file, 'utf8') }],
      scrollers: ['html'],
      clippers: [],
      hovered: ['#guide-view a'],
    },
    {
      // The simulation settles differently from run to run, so the canvas
      // is hidden and only the controls around it are compared; the canvas
      // is held to its recorded calls instead. With the canvas hidden, the
      // probe's report would show through where it was, so it goes too.
      page: 'notesGraph',
      viewport: [1100, 800],
      snapshot: () => ({ ...graph, focus: { local: false, depth: 1, skipPeriodic: false, workspaceNodeCount: graph.nodes.length } }),
      css: 'canvas { visibility: hidden !important; } #layout-probe { display: none !important; }',
      scrollers: ['html'],
      clippers: [],
      hovered: ['button'],
    },
    {
      // The debug page's tables are as wide as their evidence: with this
      // entry's candidates the page scrolls sideways even at 1400px. It is a
      // diagnostic for whoever tunes the ranking, and promises no width, so
      // nothing is measured for overflow; it is here for its DOM and pixels.
      page: 'relatedNotesDebug',
      viewport: [1100, 900],
      pageOptions: () => ({ diagnostic: createDiagnostic(index, files) }),
      scrollers: [],
      clippers: [],
      hovered: ['tbody tr'],
    },
  ];
}

/**
 * A menu open over a page, so a floating layer at the body's level is drawn
 * and compared too: the tag menu on a search result, and a card's action
 * menu on the board.
 *
 * @param {object[]} surfaces The surfaces already made, whose snapshots these reuse.
 * @returns {object[]} The two pages with their menu open.
 */
function createMenuSurfaces(surfaces) {
  const of = (name) => surfaces.find((surface) => (surface.name || surface.page) === name);
  return [
    {
      ...of('searchPage'),
      name: 'searchTagMenu',
      drive: [['contextmenu', '.card [data-tag-key]']],
      hovered: ['#tag-context-menu .menu-item'],
    },
    {
      ...of('taskBoard'),
      name: 'taskBoardCardMenu',
      drive: [['click', '.board-card [data-action="board-menu"]']],
      hovered: ['#action-menu .menu-item'],
    },
  ];
}

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
  const surfaces = [
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
  return [
    ...surfaces,
    ...createDashboardSurfaces(index, preferences.reader.value),
    ...createReferenceSurfaces(index, files),
    ...createMenuSurfaces(surfaces),
  ];
}

/**
 * The page a surface draws, as its host renders it: the page every surface
 * of it shares, or one rendered with the surface's own page options.
 *
 * @param {{ page: string, pageOptions?: () => object }} surface Which page it draws, and any options of its own.
 * @param {Map<string, string>} rendered Every page in this theme and zen state, by name.
 * @param {{ theme: string, zen: boolean }} chrome The theme and zen state the page is drawn in.
 * @returns {string} The page's HTML.
 */
function surfaceHtml(surface, rendered, chrome) {
  return surface.pageOptions
    ? renderPage(surface.page, { ...chrome, pageOptions: surface.pageOptions() })
    : rendered.get(surface.page);
}

module.exports = { createSurfaces, surfaceHtml, NOW };
