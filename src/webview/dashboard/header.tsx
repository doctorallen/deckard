/**
 * The top of the Dashboard: its name and the tab shown, the three tiles of
 * what wants doing, the gear, and the Home and Tags tabs.
 */
import type { TaskGlance } from '../../ui/protocol/dashboard';
import { Eyebrow } from '../shared/eyebrow';
import { Metric } from '../shared/metric';
import { displayLevelOption, pageWidthOption, themeOption, ViewOptionChoices, ViewOptions } from '../shared/viewOptions';
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

/** The gear: Customize, the tag columns, the walkthrough, the theme, and zen. */
function DashboardOptions({ snapshot, view }: DashboardDraw) {
  const editing = view.editingHome;
  return (
    <ViewOptions
      groups={[
        {
          label: 'Home',
          content: (
            <button type="button" class={editing ? 'active' : ''} data-action={editing ? 'finish-customizing' : 'customize-home'} aria-pressed={editing}>
              {editing ? 'Done customizing' : 'Customize'}
            </button>
          ),
        },
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
        { label: 'Get started', content: <button type="button" data-action="open-view" data-view="walkthrough">Walkthrough</button> },
        themeOption(),
        pageWidthOption(),
        displayLevelOption(),
      ]}
    />
  );
}

/** The Dashboard's name and the tab shown, the tiles, and the gear after them. */
export function PageHeader(props: DashboardDraw) {
  return (
    <header>
      <div><Eyebrow trail="WORKSPACE INDEX" /><h1>{`Dashboard: ${props.view.mode === 'home' ? 'Home' : 'Tags'}`}</h1></div>
      <div class="dashboard-header-actions"><TaskTiles glance={props.snapshot.taskGlance} /><DashboardOptions {...props} /></div>
    </header>
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

/** Home and Tags, one tab stop between them, each naming the panel it shows, and on Home the way to arrange it. */
export function ModeTabs({ view, filter }: { readonly view: DashboardDraw['view']; readonly filter: TagFilter }) {
  const home = view.mode === 'home';
  return (
    <div class="dashboard-tabs-row">
      <div class="segmented dashboard-tabs" role="tablist" aria-label="Dashboard mode">
        <button id="home-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="home" aria-selected={home} aria-controls="home-panel" tabIndex={home ? 0 : -1}>Home</button>
        <button id="browse-tab" role="tab" data-action="set-dashboard-mode" data-dashboard-mode="browse" aria-selected={!home} aria-controls="browse-panel" tabIndex={home ? -1 : 0}>
          Tags
          <TabSearchMark query={view.browseQuery} filter={filter.namespaceLabel ? `Namespace: ${filter.namespaceLabel}` : ''} />
        </button>
      </div>
      {home && !view.editingHome
        ? <button type="button" class="text-button dashboard-customize" data-action="customize-home">Customize Home</button>
        : null}
    </div>
  );
}
