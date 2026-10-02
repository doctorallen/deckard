/**
 * What each kind of Home widget shows inside its frame: its list, its empty
 * line, and its own controls, from what the host built for it.
 */
import type { ComponentChild } from 'preact';

import { QUICK_ADD_MAX_LENGTH } from '../../domain/dashboard/widgetCatalog';
import type { DashboardWidget, DashboardWidgetKind } from '../../ui/protocol/dashboard';
import type { DashboardTask } from '../../ui/protocol/shared';
import type { HomeContext } from './homeContext';
import {
  EmptyLine,
  HomeNotes,
  HomeTags,
  HomeTasks,
  OpenSearchPageLine,
  RowAction,
  SavedFilterList,
  TagPairs,
} from './rows';

/** What a widget's body is drawn from: the widget, and what Home holds besides. */
export interface WidgetBodyProps {
  readonly widget: DashboardWidget;
  readonly home: HomeContext;
}

/** One suggestion, with the button that does it, Not now, and Do not suggest this. */
function TryNextBody({ widget }: WidgetBodyProps) {
  const next = widget.tryNext;
  if (!next) {
    return <p class="empty">Nothing to suggest yet. A suggestion appears here when your notes are ready for one.</p>;
  }
  return (
    <>
      <p class="try-next-text">{next.text}</p>
      <div class="try-next-actions">
        <button type="button" class="active" data-action="run-try-next" data-key={next.key}>{next.action.label}</button>
        <button type="button" data-action="snooze-try-next" data-key={next.key} data-tip="Put it off for a week">Not now</button>
        <button type="button" data-action="retire-try-next" data-key={next.key}>Do not suggest this</button>
      </div>
    </>
  );
}

/** Tasks, as a list draws them, or what to say for none. */
function Tasks({ tasks, empty, home }: { readonly tasks: readonly DashboardTask[] | undefined; readonly empty: string; readonly home: HomeContext }) {
  return <HomeTasks tasks={tasks} empty={empty} titleDisplay={home.titleDisplay} />;
}

/** The tasks a search finds, or why the search could not run. */
function TasksBody({ widget, home }: WidgetBodyProps) {
  return widget.error
    ? <p class="query-error" role="alert">{widget.error}</p>
    : <Tasks tasks={widget.tasks} empty={`No tasks match ${widget.query || 'this search'}.`} home={home} />;
}

/**
 * The line under the Tasks view widget: what was finished today, and how
 * many tasks need a new date, which opens them. Nothing when both are 0.
 */
function AgendaFooter({ widget }: { readonly widget: DashboardWidget }) {
  const parts: ComponentChild[] = [];
  if (widget.doneToday) {
    parts.push(<span>{`${widget.doneToday} done today`}</span>);
  }
  if (widget.needsNewDate) {
    const label = `${widget.needsNewDate}${widget.needsNewDate === 1 ? ' needs' : ' need'} a new date`;
    if (parts.length) {
      parts.push(' · ');
    }
    parts.push(
      <button type="button" class="text-button" data-action="open-search" data-query={widget.needsNewDateQuery || 'is:needs-date'} data-tip="Search the tasks more than a month past their due date">{label}</button>,
    );
  }
  return parts.length ? <p class="home-widget-footer">{parts}</p> : null;
}

/** Overdue, today, and upcoming, each group that has a task, and the line under them. */
function AgendaBody({ widget, home }: WidgetBodyProps) {
  const groups = (widget.agenda || []).filter((group) => group.count > 0);
  return (
    <>
      {groups.length
        ? groups.map((group) => [
          <h3 key={`${group.id}-heading`} class="home-widget-group">{`${group.label} `}<span class="tag-count">{group.count}</span></h3>,
          <Tasks key={`${group.id}-tasks`} tasks={group.tasks} empty="" home={home} />,
        ])
        : <EmptyLine text="Nothing is overdue or due soon." />}
      <AgendaFooter widget={widget} />
    </>
  );
}

/** Saved searches, each a row, or a way to a search page to save one. */
function SavedSearchesBody({ widget }: WidgetBodyProps) {
  return widget.savedFilters && widget.savedFilters.length
    ? <SavedFilterList filters={widget.savedFilters} />
    : <OpenSearchPageLine text="Save a search from a search page to keep it here. " />;
}

/** The searches run lately, each opening its search page. */
function RecentSearchesBody({ widget }: WidgetBodyProps) {
  if (!widget.queries || !widget.queries.length) {
    return <OpenSearchPageLine text="The searches you run show up here. " />;
  }
  return (
    <div class="home-list">
      {widget.queries.map((query, position) => (
        <button key={`${position}:${query}`} type="button" class="row saved-filter-row home-row" data-action="open-search" data-query={query}>
          <span class="home-row-label"><code>{query}</code></span>
        </button>
      ))}
    </div>
  );
}

/** How many notes, tasks, and tags there are. */
function StatsBody({ widget }: WidgetBodyProps) {
  return (
    <div class="metrics">
      {(widget.stats || []).map((stat) => (
        <div class="metric"><span class="metric-value">{stat.value}</span><span class="metric-label">{stat.label}</span></div>
      ))}
    </div>
  );
}

/** Today's date, and its note's open tasks, or the offer to create the note. */
function TodayNoteBody({ widget, home }: WidgetBodyProps) {
  const today = widget.today;
  const summary = (
    <div class="home-today-summary">
      <span class="home-today-date">{(today && today.date) || null}</span>
      {today && today.filePath ? null : <button type="button" data-action="open-daily-note">Create today’s note</button>}
    </div>
  );
  if (!today || !today.filePath) {
    return <>{summary}<EmptyLine text="There is no daily note for today yet." /></>;
  }
  return <>{summary}<Tasks tasks={widget.tasks} empty="No open tasks in today’s note." home={home} /></>;
}

/** A field that adds a task to today's note, and what became of the last one. */
function QuickAddBody({ widget, home }: WidgetBodyProps) {
  const today = widget.today;
  const target = today && today.filePath ? `today’s note, ${today.date}` : `a new note for ${(today && today.date) || 'today'}`;
  return (
    <>
      <form class="home-quick-add" data-form="quick-add">
        <input
          type="text"
          data-action="quick-add-draft"
          value={home.quickAdd.draft}
          maxLength={QUICK_ADD_MAX_LENGTH}
          placeholder="Call Ren about the audit #project/atlas 📅 tomorrow"
          aria-label="Task to add to today’s note"
          autocomplete="off"
          {...SPELLCHECK}
        />
        <button type="submit">Add</button>
      </form>
      <p class="home-quick-add-status" role="status">{home.quickAdd.status || `Adds an open task to ${target}.`}</p>
    </>
  );
}

/** `spellcheck="true"`, written as an attribute, as the template wrote it. */
const SPELLCHECK: Readonly<Record<string, string>> = { spellCheck: 'true' };

/** The notes related to the note last open, under its name. */
function RelatedNotesBody({ widget }: WidgetBodyProps) {
  const source = widget.sourceNote;
  if (!source) {
    return <EmptyLine text="Open a note to see the notes related to it." />;
  }
  return (
    <>
      <div class="home-widget-source"><span>{'Related to '}<strong>{source.title}</strong></span></div>
      <HomeNotes notes={widget.notes} empty="No notes share its tags." />
    </>
  );
}

/** Tags with no hub note, each with Create hub beside it. */
function UnhubbedTagsBody({ widget }: WidgetBodyProps) {
  return (
    <HomeTags
      tags={widget.tags}
      empty="Every frequently used tag has a hub note."
      actionFor={(tag) => <RowAction action="create-tag-hub" attributes={{ 'data-tag-key': tag.key }} label="Create hub" title={`Create a hub note for ${tag.label}`} />}
    />
  );
}

/** Tags first seen lately, each with Rename beside it. */
function NewTagsBody({ widget }: WidgetBodyProps) {
  return (
    <HomeTags
      tags={widget.tags}
      empty={`No tag was first seen in the last ${widget.days || 14} days.`}
      actionFor={(tag) => <RowAction action="rename-tag" attributes={{ 'data-tag-key': tag.key }} label="Rename" title={`Rename ${tag.label} everywhere`} />}
    />
  );
}

/** Tags of a namespace not written about lately; with nothing open, each offers its next action. */
function QuietPeopleBody({ widget }: WidgetBodyProps) {
  const kind = widget.namespace || 'person';
  const days = widget.days || 90;
  const empty = widget.noOpenTasks
    ? `Every ${kind} tag written in the last ${days} days has an open task.`
    : `Every ${kind} tag has come up in the last ${days} days.`;
  // A tag with nothing open is a stuck project: offer its next action.
  return (
    <HomeTags
      tags={widget.tags}
      empty={empty}
      actionFor={widget.noOpenTasks
        ? (tag) => <RowAction action="add-next-action" attributes={{ 'data-tag-key': tag.key }} label="Add next action" title={`Capture a next action for ${tag.label}`} />
        : undefined}
    />
  );
}

/**
 * The notes pinned to Home, each opening at the entry it names, with × to
 * let go of it. Home lists pins and lets go of them; pinning happens where
 * the note is: the editor, a search result, or the command.
 */
function PinnedNotesBody({ widget }: WidgetBodyProps) {
  return (
    <HomeNotes
      notes={widget.notes}
      empty="Pin the note you are in with “Deckard: Pin Note to Home”, or right-click a search result."
      actionFor={(note) => <RowAction action="unpin-note" attributes={{ 'data-pin-key': note.pinKey || '' }} label="×" title={`Unpin ${note.title}`} />}
    />
  );
}

/** What one saved search finds: its notes and its open tasks, or its tasks alone for one saved on the Task Board. */
function SavedQueryBody({ widget, home }: WidgetBodyProps) {
  if (widget.missing) {
    return <p class="home-widget-empty">{'This saved search was removed. '}<button type="button" data-action="customize-home">Pick another</button></p>;
  }
  // A search saved on the Task Board finds tasks alone.
  if (widget.savedPage === 'taskBoard') {
    return <Tasks tasks={widget.tasks} empty="No open tasks match." home={home} />;
  }
  return (
    <>
      <h3 class="home-widget-group">{'Notes '}<span class="tag-count">{widget.noteTotal || 0}</span></h3>
      <HomeNotes notes={widget.notes} empty="No notes match." />
      <h3 class="home-widget-group">{'Open tasks '}<span class="tag-count">{widget.total || 0}</span></h3>
      <Tasks tasks={widget.tasks} empty="No open tasks match." home={home} />
    </>
  );
}

/** What each kind of widget draws inside its frame. */
const BODIES: Readonly<Record<DashboardWidgetKind, (props: WidgetBodyProps) => ComponentChild>> = {
  tryNext: TryNextBody,
  search: ({ home }) => home.searchBar(),
  tasks: TasksBody,
  agenda: AgendaBody,
  favoriteTags: ({ widget }) => <HomeTags tags={widget.tags} empty="Favorite a tag on the Tags tab to keep it here." />,
  topTags: ({ widget }) => <HomeTags tags={widget.tags} empty="The tags you open most show up here." />,
  savedSearches: SavedSearchesBody,
  recentSearches: RecentSearchesBody,
  recentNotes: ({ widget }) => <HomeNotes notes={widget.notes} empty="The notes you open from Deckard show up here." />,
  stats: StatsBody,
  todayNote: TodayNoteBody,
  quickAdd: QuickAddBody,
  staleTasks: ({ widget, home }) => <Tasks tasks={widget.tasks} empty={`No open task sits in a note left unchanged for ${widget.days || 30} days.`} home={home} />,
  relatedNotes: RelatedNotesBody,
  tagPairs: ({ widget }) => <TagPairs pairs={widget.tagPairs} />,
  unhubbedTags: UnhubbedTagsBody,
  newTags: NewTagsBody,
  quietPeople: QuietPeopleBody,
  pinnedNotes: PinnedNotesBody,
  savedQuery: SavedQueryBody,
};

/** What one widget shows; nothing for a kind this page does not know. */
export function WidgetBody(props: WidgetBodyProps) {
  const body = Object.hasOwn(BODIES, props.widget.kind) ? BODIES[props.widget.kind] : undefined;
  return body ? <>{body(props)}</> : null;
}
