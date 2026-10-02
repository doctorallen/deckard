/**
 * One widget on Home, in its frame: its title and count, where it leads or,
 * while Home is arranged, its width, its gear, and Remove; then what it
 * shows, and, for a paged widget, its pager.
 */
import type { ComponentChild } from 'preact';

import { WIDGET_KINDS } from '../../domain/dashboard/widgetCatalog';
import type { DashboardWidget } from '../../ui/protocol/dashboard';
import { SettingsIcon } from '../shared/icons';
import { describePageRange } from '../shared/pageSteps';
import { ViewOptionChoices } from '../shared/viewOptions';
import type { HomeContext } from './homeContext';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import type { Attributes } from './rows';
import { WidgetBody } from './widgetBodies';

/** What a widget's parts are drawn from. */
interface WidgetProps {
  readonly widget: DashboardWidget;
  readonly home: HomeContext;
}

/** Where a widget leads: a button that opens a page, a view, or the Tags tab. */
function OpenLink({ action, attributes, label }: { readonly action: string; readonly attributes?: Attributes; readonly label: string }) {
  return <button type="button" class="home-open" data-action={action} {...attributes}>{`${label} →`}</button>;
}

/** The Tags tab, where every tag a widget lists a few of is. */
function allTags(): ComponentChild {
  return <OpenLink action="set-dashboard-mode" attributes={{ 'data-dashboard-mode': 'browse' }} label="All tags" />;
}

/** Where each kind of widget leads, when it leads anywhere. */
const OPEN_LINKS: Readonly<Partial<Record<DashboardWidget['kind'], (widget: DashboardWidget) => ComponentChild>>> = {
  tasks: (widget) => <OpenLink action="open-task-board" attributes={{ 'data-query': widget.query || '' }} label="Task Board" />,
  agenda: () => <OpenLink action="open-view" attributes={{ 'data-view': 'agenda' }} label="Tasks view" />,
  favoriteTags: allTags,
  topTags: allTags,
  stats: () => <OpenLink action="open-view" attributes={{ 'data-view': 'stats' }} label="Stats" />,
  todayNote: (widget) => (widget.today && widget.today.filePath ? <OpenLink action="open-daily-note" label="Open" /> : null),
  staleTasks: () => <OpenLink action="open-task-board" attributes={{ 'data-query': 'is:open' }} label="Task Board" />,
  unhubbedTags: allTags,
  newTags: allTags,
  quietPeople: allTags,
  tagPairs: allTags,
  relatedNotes: (widget) =>
    (widget.sourceNote ? <OpenLink action="open-note" attributes={{ 'data-file-path': widget.sourceNote.filePath }} label="Open note" /> : null),
  savedQuery: (widget) => {
    if (widget.missing) {
      return null;
    }
    return widget.savedPage === 'taskBoard'
      ? <OpenLink action="open-task-board" attributes={{ 'data-query': widget.savedQuery || '' }} label="Task Board" />
      : <OpenLink action="open-search" attributes={{ 'data-query': widget.savedQuery || '' }} label="Open" />;
  },
};

/** Where a widget leads, when it leads anywhere. */
function WidgetOpen({ widget }: { readonly widget: DashboardWidget }) {
  const link = Object.hasOwn(OPEN_LINKS, widget.kind) ? OPEN_LINKS[widget.kind] : undefined;
  return link ? <>{link(widget)}</> : null;
}

/** One row of a widget's gear: its label, over or beside its choices. */
function OptionsGroup({ label, stacked, children }: { readonly label: string; readonly stacked?: boolean; readonly children: ComponentChild }) {
  return <div class={stacked ? 'view-options-group is-stacked' : 'view-options-group'}><span>{label}</span>{children}</div>;
}

/** The rows of a widget's gear that set how many it lists, whether it pages, and how far back it looks. */
function listingGroups(widget: DashboardWidget, attributes: Readonly<Record<string, string>>): ComponentChild[] {
  const groups: ComponentChild[] = [];
  if (!Object.hasOwn(WIDGET_KINDS, widget.kind)) {
    return groups;
  }
  const traits = WIDGET_KINDS[widget.kind];
  if (traits.listed && !widget.paged) {
    groups.push(
      <OptionsGroup label="Show">
        <ViewOptionChoices action="set-widget-count" choices={[[3, '3'], [5, '5'], [10, '10'], [20, '20']]} selected={widget.count || 5} label="Entries shown" attributes={attributes} />
      </OptionsGroup>,
    );
  }
  if (traits.listed && traits.pageable !== false) {
    groups.push(
      <OptionsGroup label="Paging">
        <ViewOptionChoices action="set-widget-paged" choices={[['off', 'Off', 'Show the first few'], ['on', 'On', 'Page through all of them']]} selected={widget.paged ? 'on' : 'off'} label="Paging" attributes={attributes} />
      </OptionsGroup>,
    );
  }
  if (traits.days) {
    groups.push(
      <OptionsGroup label={widget.kind === 'newTags' ? 'Seen within' : 'Unchanged for'}>
        <ViewOptionChoices action="set-widget-days" choices={traits.days} selected={widget.days || traits.defaultDays} label="Days" attributes={attributes} />
      </OptionsGroup>,
    );
  }
  return groups;
}

/** Gone quiet's rows: the namespace it watches, and whether only those with nothing open. */
function quietPeopleGroups(widget: DashboardWidget, attributes: Readonly<Record<string, string>>): ComponentChild[] {
  const namespaces = widget.namespaces && widget.namespaces.length ? widget.namespaces : ['person'];
  const watched = widget.namespace || 'person';
  return [
    <OptionsGroup label="Namespace" stacked>
      <select data-action="set-widget-namespace" {...attributes} aria-label="Namespace to watch">
        {namespaces.map((name) => <option key={name} value={name} selected={name === watched}>{name}</option>)}
      </select>
    </OptionsGroup>,
    <div class="view-options-group">
      <label class="control-label"><input type="checkbox" data-action="set-widget-no-open-tasks" {...attributes} checked={Boolean(widget.noOpenTasks)} />{' Only those with no open tasks'}</label>
    </div>,
  ];
}

/** `spellcheck="false"`, written as an attribute in every browser: Chrome's property would read the string as true. */
const NO_SPELLCHECK: Readonly<Record<string, string>> = { spellCheck: 'false' };

/** The rows a widget's own kind adds to its gear: Gone quiet's, a tasks widget's search, and a saved search's choice. */
function kindGroups(widget: DashboardWidget, home: HomeContext, attributes: Readonly<Record<string, string>>): ComponentChild[] {
  if (widget.kind === 'quietPeople') {
    return quietPeopleGroups(widget, attributes);
  }
  if (widget.kind === 'tasks') {
    const draft = home.queryDrafts[widget.id] ?? (widget.query || '');
    return [
      <OptionsGroup label="Search" stacked>
        <form class="home-widget-form" data-form="widget-query" {...attributes}>
          <input type="text" data-action="widget-query-draft" {...attributes} value={draft} placeholder="is:open #project/atlas" aria-label="Tasks to list" autocomplete="off" {...NO_SPELLCHECK} />
          <button type="submit">Save</button>
        </form>
      </OptionsGroup>,
    ];
  }
  if (widget.kind === 'savedQuery') {
    return [
      <OptionsGroup label="Saved search" stacked>
        <select data-action="set-widget-filter" {...attributes} aria-label="Saved search to show">
          {home.savedFilters.map((filter) => <option key={filter.id} value={filter.id} selected={filter.id === widget.filterId}>{filter.name}</option>)}
        </select>
      </OptionsGroup>,
    ];
  }
  return [];
}

/** A widget's own settings, in the menu its gear opens; nothing for a widget with none. */
function WidgetOptions({ widget, home }: WidgetProps) {
  const attributes = { 'data-widget-id': widget.id };
  const groups = [...listingGroups(widget, attributes), ...kindGroups(widget, home, attributes)];
  const description = Object.hasOwn(WIDGET_KINDS, widget.kind) ? WIDGET_KINDS[widget.kind].description : '';
  if (description) {
    groups.unshift(<OptionsGroup label="About" stacked><p class="home-widget-about">{description}</p></OptionsGroup>);
  }
  if (!groups.length) {
    return null;
  }
  return (
    <details class="home-widget-options" {...attributes} open={home.openOptions === widget.id}>
      <summary aria-label="Widget options" data-tip="Widget options"><SettingsIcon /></summary>
      <div class="home-widget-options-menu popover is-dropdown">{groups}</div>
    </details>
  );
}

/** While Home is arranged: the widget's width, its gear, and Remove. */
function ArrangingActions({ widget, home }: WidgetProps) {
  return (
    <>
      <ViewOptionChoices action="set-widget-width" choices={[['half', '½', 'Half width'], ['full', 'Full', 'Full width']]} selected={widget.width} label="Width" attributes={{ 'data-widget-id': widget.id }} />
      <WidgetOptions widget={widget} home={home} />
      <button type="button" class="home-remove" data-action="remove-widget" data-widget-id={widget.id} aria-label={`Remove ${widget.title}`} data-tip="Remove widget">×</button>
    </>
  );
}

/** One step of a pager: the page it goes to, which way, and whether it can. */
interface PageStepProps {
  readonly widget: DashboardWidget;
  readonly page: number;
  readonly label: 'Previous' | 'Next';
  readonly enabled: boolean;
}

/** A chevron that walks a widget's list a page back or on. */
function PageStep({ widget, page, label, enabled }: PageStepProps) {
  return (
    <button type="button" data-action="set-widget-page" data-page={page} data-widget-id={widget.id} disabled={!enabled} aria-label={`${label} page of ${widget.title}`} data-tip={`${label} page`}>
      {label === 'Previous' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}

/**
 * A paged widget's pager: how many it holds, where the reader is in the
 * list, and a step either way.
 *
 * A search page offers every page number because a reader goes to one; a
 * widget is a few entries in a corner of Home, walked a page at a time, so
 * it is two chevrons and the count it is showing.
 */
function WidgetPaging({ widget, home }: WidgetProps) {
  const paging = widget.paging;
  if (!paging || home.editing) {
    return null;
  }
  // The sizes on offer, and whatever this widget is already set to, so a
  // count chosen before it was paged is not silently changed by its own
  // control.
  const sizes = [3, 5, 10, 20, 50, paging.size]
    .filter((size, index, all) => all.indexOf(size) === index)
    .sort((left, right) => left - right);
  return (
    <nav class="home-widget-paging" aria-label={`${widget.title} pages`}>
      <label class="control-label">
        Per page:
        <select data-action="set-widget-page-size" data-widget-id={widget.id} aria-label="Entries per page">
          {sizes.map((size) => <option key={size} value={size} selected={size === paging.size}>{size}</option>)}
        </select>
      </label>
      <span class="home-widget-steps">
        <span class="page-range">{describePageRange(paging) || null}</span>
        <PageStep widget={widget} page={paging.page - 1} label="Previous" enabled={paging.page > 1} />
        <PageStep widget={widget} page={paging.page + 1} label="Next" enabled={paging.page < paging.pageCount} />
      </span>
    </nav>
  );
}

/** "5 of 37" over five rows rather than "37", which read as the whole list. */
function countText(widget: DashboardWidget): string | undefined {
  const listed = Object.hasOwn(WIDGET_KINDS, widget.kind) && WIDGET_KINDS[widget.kind].listed;
  if (widget.total === undefined || !listed) {
    return undefined;
  }
  // Each kind lists its own sort of entry, so the shown count is whichever
  // list the widget carries.
  const list = widget.tasks || widget.tags || widget.notes || widget.queries || widget.savedFilters || widget.tagPairs;
  const shown = list ? list.length : undefined;
  return !widget.paged && shown !== undefined && shown < widget.total ? `${shown} of ${widget.total}` : String(widget.total);
}

/**
 * One widget on Home. Try next with nothing to suggest is not an empty box:
 * it is nothing, until Home is being arranged.
 */
export function HomeWidget({ widget, home }: WidgetProps) {
  if (widget.kind === 'tryNext' && !widget.tryNext && !home.editing) {
    return null;
  }
  const count = countText(widget);
  let frame = 'home-widget view-panel';
  if (widget.width === 'full') {
    frame += ' is-full';
  }
  if (home.editing) {
    frame += ' is-editing is-draggable';
  }
  return (
    <article
      class={frame}
      tabIndex={home.editing ? 0 : undefined}
      data-tip={home.editing ? 'Drag to move, or press the menu key (Shift+F10) to move it first or last' : undefined}
      data-widget-id={widget.id}
      aria-label={widget.title}
    >
      <div class="home-widget-header">
        <h2 class="home-widget-title">
          {home.editing ? <span class="home-widget-grip" aria-hidden="true">⠿</span> : null}
          {count === undefined ? widget.title : `${widget.title} `}
          {count === undefined ? null : <span class="tag-count">{count}</span>}
        </h2>
        <div class="home-widget-actions">{home.editing ? <ArrangingActions widget={widget} home={home} /> : <WidgetOpen widget={widget} />}</div>
      </div>
      <WidgetBody widget={widget} home={home} />
      <WidgetPaging widget={widget} home={home} />
    </article>
  );
}
