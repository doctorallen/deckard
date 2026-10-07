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
const { createGlobalState } = require('../e2e/support.js');
const { createTaskBoard } = modules.taskBoardState;
const { createSidebarSnapshot } = modules.relatedNotesRanking;
const { createDashboardSnapshot } = modules.dashboardState;
const { createSearchPageSnapshot } = modules.searchPageState;
const { createDeckardStatsSnapshot } = modules.statsState;
const { createNotePageSnapshot } = modules.notePageState;
const { createDashboardWidgets } = modules.dashboardWidgets;
const { createNotesGraphSnapshot } = modules.graphBuild;
const { toWire } = modules.notesGraphState;
const { createCalendar } = modules.calendarState;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexState;
const { createPreferences } = modules.preferenceServices;
// Every snapshot is built at NOW, so no surface reads the wall clock.
const { createQueryContext } = modules.queryContext;
const { listDeckardPages } = modules.deckardPages;

/** Task i's due date: six overdue, three today, the rest a day or two apart after. */
function fixtureDue(i) {
  let day = 21 + Math.ceil((i - 9) / 1.2);
  if (i <= 6) {
    day = 14 + i;
  } else if (i <= 9) {
    day = 21;
  }
  const date = new Date(2026, 8, day);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Enough tasks that the busiest column must scroll, and titles that wrap,
 * due as a real list is: a few overdue, a few today, the rest over the
 * coming month. NOW is 2026-09-21.
 */
function createIndex(withSteps = false) {
  const long = 'Chase the replicant through the neon market and file the report before the rain';
  const lines = ['# Tasks #project/atlas', ''];
  for (let i = 1; i <= 40; i += 1) {
    // In progress by their boxes; the #status/doing tag is a tag like any
    // other, kept so the pages that list tags draw what they always have.
    lines.push(`- [/] ${i === 1 ? long : `Board task ${i}`} 📅 ${fixtureDue(i)} #status/doing`);
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

const NOW = new Date(2026, 8, 21, 12).getTime();

/** Flat cards and tags as text: the looks a reader turns on, drawn on a few surfaces. */
const LOOKS = { cards: 'flat', tags: 'text' };

/** Display's preferences, each away from its default: what a page writes, drawn on Home and the board. */
const WRITTEN_HOME = { counts: 'hidden', fileAndLine: 'never', dates: 'date' };
const WRITTEN_BOARD = { counts: 'hidden', fileAndLine: 'always', dates: 'relative' };
/** A date format of the reader's own, full and short, as the body carries it. */
const DATED = { dateFormat: 'ddd D MMMM YYYY', shortDateFormat: 'ddd D MMM' };

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
    // Flat cards and tags as text, the two looks a reader turns on.
    { ...dashboard('dashboardHomeLooks', 'home', { hovered: ['.home-widget .row', '.home-widget'] }), display: LOOKS },
    // Counts hidden, file and line never, dates as the date with its state.
    { ...dashboard('dashboardHomeWritten', 'home', { hovered: ['.home-widget .row', '.home-widget'] }), display: WRITTEN_HOME },
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
 * The guide page the helpGuide surface shows: what Help's host sends for it,
 * captured in the extension host from renderGuidePage, which renders it with
 * VS Code's markdown.api.render (VS Code 1.140) and rewrites its links and
 * images. It replaced the markdown-it capture of before Phase 6 step 4, from
 * which it differs only by the engine's data-line, code-line, and dir marks.
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
 * Help at What's new, a guide page shown in Help, the Notes Graph's
 * controls, and the Related Notes debug page: the pages that had no surface
 * before Phase 6.
 *
 * @param {object} index The workspace.
 * @param {Map<string, object>} files The parsed notes, by path.
 * @returns {object[]} One surface for each of the four pages.
 */
function createReferenceSurfaces(index, files) {
  const graph = toWire(createNotesGraphSnapshot(index), { notes: true, tasks: true });
  return [
    // Help opened at What's new, which its host draws in the page; a guide
    // page is the host's to send, as helpGuide's is.
    {
      page: 'help',
      viewport: [1100, 900],
      messages: () => [{ type: 'reveal', page: 'whats-new' }],
      scrollers: ['html'],
      clippers: [],
      hovered: ['nav a'],
    },
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
      // The debug page's tables wrap their headers to fit the page, and a
      // table still too wide, as a candidate's eight columns of evidence are
      // in Tomcat's spaced capitals, scrolls in its own box: the page itself
      // never scrolls sideways.
      page: 'relatedNotesDebug',
      viewport: [1100, 900],
      pageOptions: () => ({ diagnostic: createDiagnostic(index, files) }),
      scrollers: ['html'],
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
 * The Task Board with a task of every status, and its Cancelled column.
 *
 * @param {object} preferences The preference services, whose reader holds what is stored.
 * @returns {object} The board surface, drawn at a wide width.
 */
function createStatusBoardSurface(preferences) {
  return {
      // Every status a box can draw: in progress half filled, blocked with
      // its icon, an unknown character outlined, on hold, done, and a
      // Cancelled column, struck through.
      name: 'taskBoardStatuses',
      page: 'taskBoard',
      viewport: [1400, 700],
      snapshot: () => createTaskBoard({
        index: statusIndex(),
        preferences: preferences.reader.value,
        search: { query: '' },
        options: { queryContext: createQueryContext(NOW), format: 'emoji', hiddenColumns: [] },
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['html', '.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    };
}

/**
 * The Task Board with each card's parent tag above its title: a heading's
 * tag, one passed down through an untagged heading, and the note's own.
 *
 * @param {object} preferences The preference services, whose reader holds what is stored.
 * @returns {object} The board, by status, with parent tags shown.
 */
function createParentTagBoardSurface(preferences) {
  const text = [
    '---',
    'tags: [area/research]',
    '---',
    '# Field season',
    '- [ ] Book the flights',
    '## Antenna array #project/atlas',
    '- [/] Calibrate the receivers',
    '- [w] Hear back from legal',
    '### Cabling',
    '- [ ] Order the connectors',
    '## Vendors #team/ops',
    '- [=] Wait for the vendor\'s quote',
  ].join('\n');
  const index = buildWorkspaceIndex(new Map([['notes/field-season.md', parseMarkdown('notes/field-season.md', text)]]));
  return {
    name: 'taskBoardParentTags',
    page: 'taskBoard',
    viewport: [1400, 600],
    snapshot: () => createTaskBoard({
      index,
      preferences: preferences.reader.value,
      search: { query: '' },
      options: { queryContext: createQueryContext(NOW), format: 'emoji', parentTag: true },
      tagTitleDisplayMode: 'inline',
    }),
    scrollers: ['html', '.board-cards'],
    clippers: ['.board-column'],
    hovered: ['.board-card', '.parent-tag'],
  };
}

/** A note with a task of every status a board draws. */
function statusIndex() {
  const text = [
    '# Statuses',
    '- [ ] Draft the brief',
    '- [/] Calibrate the receivers',
    '- [w] Hear back from legal',
    '- [=] Wait for the vendor\'s quote',
    '- [?] Ask about the second lens',
    '- [x] Book the room ✅ 2026-09-24',
    '- [-] Order the banner ❌ 2026-09-23',
  ].join('\n');
  return buildWorkspaceIndex(new Map([['notes/statuses.md', parseMarkdown('notes/statuses.md', text)]]));
}

/**
 * The Task Board, by status, grouped by a tag namespace, and opened from the
 * Tasks view's search icon to edit what the view lists. Only the board's
 * surfaces carry steps, so no other page's pixels move with them.
 *
 * @param {object} boardIndex The workspace, with steps on the first task.
 * @param {object} preferences The preference services, whose reader holds what is stored.
 * @returns {object[]} The three board surfaces.
 */
function createBoardSurfaces(boardIndex, preferences) {
  return [
    {
      page: 'taskBoard',
      viewport: [1400, 900],
      snapshot: () => createTaskBoard({
        index: boardIndex,
        preferences: preferences.reader.value,
        search: { query: '' },
        options: { queryContext: createQueryContext(NOW), format: 'emoji' },
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
        options: { queryContext: createQueryContext(NOW), format: 'emoji' },
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['html', '.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    },
    {
      // Counts hidden, file and line under every card, dates as how far off.
      name: 'taskBoardWritten',
      page: 'taskBoard',
      display: WRITTEN_BOARD,
      viewport: [900, 700],
      snapshot: () => createTaskBoard({
        index: boardIndex,
        preferences: preferences.reader.value,
        search: { query: '' },
        options: { queryContext: createQueryContext(NOW), format: 'emoji' },
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['html', '.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    },
    {
      // Editing what the Tasks view lists: the strip above the search box,
      // and Save to Tasks view filled beside Save as search, a bar one
      // button longer that must still wrap rather than push the page
      // sideways at a narrower width.
      name: 'taskBoardTasksView',
      page: 'taskBoard',
      viewport: [900, 700],
      snapshot: () => ({
        ...createTaskBoard({
          index: boardIndex,
          preferences: preferences.reader.value,
          search: { query: '#project/atlas' },
          options: { queryContext: createQueryContext(NOW), format: 'emoji' },
          tagTitleDisplayMode: 'inline',
        }),
        tasksViewMode: { listed: false },
      }),
      scrollers: ['html', '.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.query-bar-row .query-primary'],
    },
  ];
}

/**
 * Deckard's pages as Context draws them at its top, every page kept, with
 * hints as they read at NOW, drawn as `style` says and with `current` in
 * front, if any.
 *
 * @param {'list' | 'icons'} style How the pages are drawn.
 * @param {string} [current] The page in front, drawn pressed.
 * @returns {object} The pages, as the sidebar's state carries them.
 */
function createContextPages(style, current) {
  const facts = { dueToday: 3, overdue: 2, notes: 42, files: 30, today: new Date(NOW), todayNoteExists: false, findKey: '⌥⇧⌘F' };
  const pages = listDeckardPages(facts).map(({ id, label, description, detail }) => ({ id, label, description, detail }));
  return { style, pages, ...(current ? { current } : {}) };
}

/**
 * The sidebar calendar, with and without its weekends, Related Notes showing
 * the calendar page's chosen day, and the calendar page, wide and narrow.
 * Each draws its own small month, so no other surface's pixels move with it.
 *
 * @returns {object[]} The five calendar surfaces.
 */
function createCalendarSurfaces() {
  return [
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
      // Related Notes showing the calendar page's chosen day, under the
      // pages as a row of icons, the calendar pressed.
      name: 'sidebarNotesCalendarDay',
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => ({
        pages: createContextPages('icons', 'calendar'),
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
  ];
}

/**
 * Related Notes for a tagged note, and for a note with no tags, and the
 * sidebar's Customize Home.
 *
 * @param {object} index The workspace.
 * @param {Map<string, object>} files The parsed notes, by path.
 * @returns {object[]} The two Related Notes surfaces and Customize Home.
 */
function createRelatedNotesSurfaces(index, files) {
  return [
    {
      // As narrow as a reader is likely to drag the sidebar: the page's own
      // floor is 220px. The pages lead, as rows with their hints.
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => ({
        ...createSidebarSnapshot(index, 'notes/atlas.md', files.get('notes/atlas.md'), {
          now: NOW,
          enableKeywordLinks: true,
          relatedNotesSortMode: 'tags',
          sectionAccessCounts: {},
          tagTitleDisplayMode: 'inline',
        }),
        pages: createContextPages('list'),
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
    {
      // Customize Home in the sidebar: each widget to add is a button with
      // its description under its name, on the button's own fill, under
      // the pages as rows, Home pressed.
      name: 'sidebarNotesCustomizeHome',
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => ({
        pages: createContextPages('list', 'home'),
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: 'inline',
        state: 'customizeHome',
        homeWidgets: [
          { value: 'tasks', label: 'Tasks', description: 'The tasks a search finds, ranked as on the Task Board' },
          { value: 'topTags', label: 'Frequent tags', description: 'The tags you open most, lately' },
          { value: 'todayNote', label: 'Today', description: "Today's daily note and its open tasks" },
        ],
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.home-widget-choice'],
    },
  ];
}

/**
 * Stats, and the search page a tag opens.
 *
 * @param {object} index The workspace.
 * @param {object} preferences The preference services, whose reader holds what is stored.
 * @returns {object[]} The Stats and search page surfaces.
 */
function createSummarySurfaces(index, preferences) {
  return [
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
        // Five minutes before the snapshot was built, at NOW, which the
        // page says as "5 minutes ago" without reading the wall clock.
        updatedAt: NOW - 5 * 60 * 1000,
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
    {
      name: 'searchPageLooks',
      page: 'searchPage',
      display: LOOKS,
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

/**
 * The note page's own notes, so no other surface's pixels move with it: a
 * project note with front matter, a heading, a task with steps, a query
 * block drawn as a table, an embed, code, a table, and two notes that link
 * to it. It is not a hub: a hub note opens as its tag's search page, so the
 * note page never shows one.
 */
function createNotePageIndex() {
  const files = new Map([
    ['projects/Atlas.md', parseMarkdown('projects/Atlas.md', [
      '---',
      'status: active',
      'owner: "@dana"',
      '---',
      '# Atlas',
      '',
      'Migration of billing onto the **new** ledger, tracked under #project/atlas with @dana. See [[Vendor review]] for the shortlist, and [the vendor site](https://example.com).',
      '',
      '## Decision',
      'The pilot stays on one route until the privacy review is done, and a range ping raises an alert only above a documented confidence threshold. ^threshold',
      '',
      '- [ ] Send the proposal to the vendor before the review 📅 2026-09-25',
      '  - [x] Draft the proposal',
      '  - [ ] Get sign-off from @dana',
      '- [x] Pick a vendor ✅ 2026-09-18',
      '- A plain item, with `code` in it',
      '',
      '> A quote from the kickoff, kept for the record.',
      '',
      '```deckard view=table columns=due,priority',
      '#project/atlas is:task',
      '```',
      '',
      '![[Vendor review#Shortlist]]',
      '',
      '| Vendor | Cost |',
      '| --- | --- |',
      '| Praxis Loom | 12,000 |',
      '',
      '```js',
      'const threshold = 0.82;',
      '```',
    ].join('\n'))],
    ['notes/Vendor review.md', parseMarkdown('notes/Vendor review.md', [
      '# Vendor review #project/atlas',
      '',
      '## Shortlist',
      'Praxis Loom and Halcyon both meet the threshold in [[Atlas#Decision]].',
      '- [ ] Call Halcyon about the audit 📅 2026-09-23 ⏫',
    ].join('\n'))],
    ['notes/Kickoff.md', parseMarkdown('notes/Kickoff.md', '---\nup: "[[Atlas]]"\n---\n# Kickoff\nWe start with [[Atlas]] next week.')],
  ]);
  return buildWorkspaceIndex(files);
}

/** The note page: a note with every kind of block, opened at its Decision heading. */
function createNotePageSurfaces() {
  const index = createNotePageIndex();
  return [
    {
      page: 'notePage',
      viewport: [900, 1400],
      snapshot: () => createNotePageSnapshot(index, 'projects/Atlas.md', {
        queryContext: createQueryContext(NOW),
        history: { back: true, forward: false },
        visit: 1,
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note-query-title'],
    },
    {
      name: 'notePageLooks',
      page: 'notePage',
      display: LOOKS,
      viewport: [900, 1400],
      snapshot: () => createNotePageSnapshot(index, 'projects/Atlas.md', {
        queryContext: createQueryContext(NOW),
        history: { back: true, forward: false },
        visit: 1,
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note-query-title'],
    },
  ];
}

/**
 * Edit Task Statuses, as the settings have them and with characters found
 * in the notes, and in the workflow, where each row has its next status.
 */
function createTaskStatusesSurfaces() {
  const statuses = [
    { symbol: ' ', name: 'Todo', type: 'todo', next: 'x' },
    { symbol: '/', name: 'In progress', type: 'inProgress', next: 'x' },
    { symbol: 'x', name: 'Done', type: 'done', next: ' ' },
    { symbol: 'X', name: 'Done', type: 'done', next: ' ' },
    { symbol: '-', name: 'Cancelled', type: 'cancelled', next: ' ' },
    { symbol: 'w', name: 'Waiting', type: 'onHold', next: ' ' },
    { symbol: 's', name: 'Someday', type: 'onHold', next: ' ' },
    { symbol: '=', name: 'Blocked', type: 'onHold', icon: 'blocked', next: ' ' },
  ];
  const snapshot = (checkboxClick) => ({ statuses, checkboxClick, found: [{ symbol: '?', count: 3 }], canImport: true, target: 'user' });
  return [
    {
      page: 'taskStatuses',
      viewport: [900, 640],
      snapshot: () => snapshot('done'),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.status-actions button'],
    },
    {
      name: 'taskStatusesWorkflow',
      page: 'taskStatuses',
      viewport: [900, 760],
      snapshot: () => snapshot('workflow'),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.status-actions button'],
    },
  ];
}

/**
 * The surfaces measured, each with the snapshot its page renders from and
 * the geometry it must keep. A probe runs in the page and reports; the
 * expectations here read the report. They are the same with zen on or off;
 * each pass makes them anew.
 */
function createSurfaces() {
  const { index, files } = createIndex();
  // Only the board's surfaces carry steps, so no other page's pixels move.
  const boardIndex = createIndex(true).index;
  const preferences = createPreferences(createGlobalState());
  const surfaces = [
    ...createBoardSurfaces(boardIndex, preferences),
    createStatusBoardSurface(preferences),
    createParentTagBoardSurface(preferences),
    createDatedBoardSurface(boardIndex, preferences),
    ...createCalendarSurfaces(),
    ...createRelatedNotesSurfaces(index, files),
    ...createSummarySurfaces(index, preferences),
    ...createNotePageSurfaces(),
    ...createTaskStatusesSurfaces(),
  ];
  return [
    ...surfaces,
    ...createDashboardSurfaces(index, preferences.reader.value),
    ...createReferenceSurfaces(index, files),
    ...createMenuSurfaces(surfaces),
  ];
}

/**
 * The Task Board with its dates in a format of the reader's own, as the
 * host words them and the page draws them: day first, with the weekday and
 * the month's name, longer than YYYY-MM-DD, and still kept to one line in
 * a card.
 *
 * @param {object} boardIndex The workspace the other board surfaces draw.
 * @param {object} preferences The preference services, whose reader holds what is stored.
 * @returns {object} The board, by status, its dates in the reader's format.
 */
function createDatedBoardSurface(boardIndex, preferences) {
  return {
    name: 'taskBoardDated',
    page: 'taskBoard',
    display: DATED,
    viewport: [900, 700],
    snapshot: () => createTaskBoard({
      index: boardIndex,
      preferences: preferences.reader.value,
      search: { query: '' },
      options: {
        queryContext: createQueryContext(NOW, { dateFormats: { date: DATED.dateFormat, short: DATED.shortDateFormat, locale: 'en', weekStart: 0 } }),
        format: 'emoji',
      },
      tagTitleDisplayMode: 'inline',
    }),
    scrollers: ['html', '.board-cards'],
    clippers: ['.board-column'],
    hovered: ['.board-card'],
  };
}

/**
 * The page a surface draws, as its host renders it: the page every surface
 * of it shares, or one rendered with the surface's own page options.
 *
 * @param {{ page: string, pageOptions?: () => object, display?: object }} surface Which page it draws, any options of its own, and any display choices it is drawn with.
 * @param {Map<string, string>} rendered Every page in this theme and zen state, by name.
 * @param {{ theme: string, zen: boolean }} chrome The theme and zen state the page is drawn in.
 * @returns {string} The page's HTML.
 */
function surfaceHtml(surface, rendered, chrome) {
  if (surface.pageOptions || surface.display) {
    return renderPage(surface.page, {
      ...chrome,
      ...(surface.display ? { display: surface.display } : {}),
      ...(surface.pageOptions ? { pageOptions: surface.pageOptions() } : {}),
    });
  }
  return rendered.get(surface.page);
}

module.exports = { createSurfaces, surfaceHtml, NOW };
