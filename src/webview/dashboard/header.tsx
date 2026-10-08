/**
 * The top of the Dashboard: its name and the tab shown, the three tiles of
 * what wants doing, ⋯, and the Home and Tags tabs.
 */
import type { TaskGlance } from '../../ui/protocol/dashboard';
import { Metric } from '../shared/metric';
import { PageBar, type PageMenuOptions } from '../shared/pageBar';
import { ViewOptionChoices } from '../shared/viewOptions';
import { TabSearchMarkIcon } from './icons';
import type { DashboardDraw } from './model';
import type { TagFilter } from './tagNames';

/** The tiles' counts and searches before the host has sent any. */
const NO_GLANCE: TaskGlance = { overdue: 0, today: 0, doneThisWeek: 0, overdueQuery: 'is:overdue -is:needs-date', todayQuery: 'is:today', doneQuery: 'done >= this-week' };

/**
 * What wants doing, not how much is written: what is due today first, then
 * what slipped, then what got done this week, so the first figure is the
 * day's work rather than the backlog. Each is a search; totals are on
 * Stats. The values stay neutral; the label says Overdue.
 */
function TaskTiles({ glance }: { readonly glance: TaskGlance | undefined }) {
  const tiles = glance || NO_GLANCE;
  return (
    <div class="metrics" role="group" aria-label="Tasks at a glance">
      <Metric label="Due today" value={tiles.today} query={tiles.todayQuery} hint="Search what is due today" code="TSK.DUE // 01" />
      <Metric label="Overdue" value={tiles.overdue} query={tiles.overdueQuery} hint="Search the overdue tasks" code="TSK.OVR // 02" />
      <Metric label="Done this week" value={tiles.doneThisWeek} query={tiles.doneQuery} hint="Search the tasks finished this week" code="TSK.DON // 03" />
    </div>
  );
}

/**
 * The ⋯'s own actions, Customize Home… (Done customizing while Home is
 * being arranged) and Walkthrough; then its view row, the Tags tab's
 * columns.
 */
function homeMenu({ snapshot, view }: DashboardDraw): PageMenuOptions {
  const editing = view.editingHome;
  return {
    actions: [
      editing
        ? { action: 'finish-customizing', text: 'Done customizing' }
        : { action: 'customize-home', text: 'Customize Home…', tip: 'Add, arrange, size and remove Home\'s widgets' },
      { action: 'open-view', text: 'Walkthrough', tip: 'Six steps through Deckard, checked off as you do them', attributes: { 'data-view': 'walkthrough' } },
    ],
    view: [
      {
        label: 'Tag columns',
        content: (
          <ViewOptionChoices
            action="set-columns"
            choices={[1, 2, 3, 4].map((columns) => [columns, String(columns), `${columns} columns`] as const)}
            selected={snapshot.tagColumns}
            label="Tag columns"
            attributes={{ 'data-section': 'tags' }}
          />
        ),
      },
    ],
    pageWidth: true,
  };
}

/** The page's one name, Home, whichever tab is shown; the tiles, and ⋯ after them. */
export function PageHeader(props: DashboardDraw) {
  return (
    <PageBar
      trail="WORKSPACE INDEX"
      lead={<h1>Home</h1>}
      label="Home"
      controlsClass="dashboard-header-actions"
      controls={<TaskTiles glance={props.snapshot.taskGlance} />}
      menu={homeMenu(props)}
    />
  );
}

/** A mark on a tab whose search has text or a filter, seen from any tab. */
function TabSearchMark({ query, filter }: { readonly query: string; readonly filter: string }) {
  const text = query.trim();
  const parts = [...(text ? [`Searching “${text}”`] : []), ...(filter ? [filter] : [])];
  if (!parts.length) {
    return null;
  }
  return (
    <>
      <span class="tab-search-mark" title={parts.join(', ')}><TabSearchMarkIcon /></span>
      <span class="visually-hidden">, searching</span>
    </>
  );
}

/**
 * Home and Tags, one tab stop between them, each naming the panel it
 * shows, and on Home a quiet Customize at the right, the visible way to
 * arrange it, beside ⋯'s Customize Home….
 */
export function ModeTabs({ view, filter }: { readonly view: DashboardDraw['view']; readonly filter: TagFilter }) {
  const home = view.mode === 'home';
  return (
    <div class="dashboard-tabs-row">
      <div class="segmented dashboard-tabs" role="tablist" aria-label="Home tabs">
        <button id="home-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="home" aria-selected={home} aria-controls="home-panel" tabIndex={home ? 0 : -1}>Home</button>
        <button id="browse-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="browse" aria-selected={!home} aria-controls="browse-panel" tabIndex={home ? -1 : 0}>
          Tags
          <TabSearchMark query={view.browseQuery} filter={filter.namespaceLabel ? `Namespace: ${filter.namespaceLabel}` : ''} />
        </button>
      </div>
      {home && !view.editingHome
        ? <button type="button" class="dashboard-customize" data-action="customize-home" data-tip="Add, arrange, size and remove Home's widgets">Customize</button>
        : null}
    </div>
  );
}
