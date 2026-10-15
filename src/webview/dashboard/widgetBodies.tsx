/**
 * What each kind of Home widget shows inside its frame: its list, its empty
 * line, and its own controls, from what the host built for it.
 */
import type { ComponentChild } from 'preact';

import { widgetNamespace } from '../../domain/dashboard/widgetCatalog';
import type { DashboardWidget, DashboardWidgetKind, DashboardWidgetQuestion } from '../../ui/protocol/dashboard';
import { EmptyState } from '../shared/emptyState';
import type { HomeContext } from './homeContext';
import {
  EmptyLine,
  HomeNotes,
  HomeRow,
  HomeTags,
  HomeTasks,
  OpenSearchPageLine,
  RowAction,
  SavedFilterList,
  WithRowAction,
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
    return <EmptyState state="Nothing to suggest yet." teach="A suggestion appears here when your notes are ready for one." />;
  }
  return (
    <>
      <p class="try-next-text">{next.text}</p>
      <div class="try-next-actions">
        <button type="button" data-action="run-try-next" data-key={next.key}>{next.action.label}</button>
        <button type="button" data-action="snooze-try-next" data-key={next.key} data-tip="Put it off for a week">Not now</button>
        <button type="button" data-action="retire-try-next" data-key={next.key}>Do not suggest this</button>
      </div>
    </>
  );
}

/** The tasks a search finds, or why the search could not run. */
function TasksBody({ widget }: WidgetBodyProps) {
  return widget.error
    ? <p class="query-error" role="alert">{widget.error}</p>
    : <HomeTasks tasks={widget.tasks} empty={`No tasks match ${widget.query || 'this search'}.`} />;
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
function AgendaBody({ widget }: WidgetBodyProps) {
  const groups = (widget.agenda || []).filter((group) => group.count > 0);
  return (
    <>
      {groups.length
        ? groups.map((group) => [
          <h3 key={`${group.id}-heading`} class={`home-widget-group${group.id === 'overdue' ? ' overdue' : ''}`}>{`${group.label} `}<span class="tag-count">{group.count}</span></h3>,
          <HomeTasks key={`${group.id}-tasks`} tasks={group.tasks} empty="" />,
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
    : <OpenSearchPageLine text="Save a search from a search page to keep it here." />;
}

/** The searches run lately, each opening its search page. */
function RecentSearchesBody({ widget }: WidgetBodyProps) {
  if (!widget.queries || !widget.queries.length) {
    return <OpenSearchPageLine text="The searches you run show up here." />;
  }
  return (
    <div class="home-list">
      {widget.queries.map((query, position) => (
        <button key={`${position}:${query}`} type="button" class="row saved-filter-row home-row" data-action="open-search" data-query={query} data-tip-around="">
          <span class="home-row-label"><code>{query}</code></span>
        </button>
      ))}
    </div>
  );
}

/** Today's date, and its note's open tasks, or the offer to create the note. */
function TodayNoteBody({ widget }: WidgetBodyProps) {
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
  return <>{summary}<HomeTasks tasks={widget.tasks} empty="No open tasks in today’s note." /></>;
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
        ? (tag) => <RowAction action="add-next-action" attributes={{ 'data-tag-key': tag.key }} label="Add next action" title={`Add a next action for ${tag.label} to today's note`} />
        : undefined}
    />
  );
}

/** Each tag of a namespace with tasks, its bar and how far along it is. */
function ProgressBody({ widget }: WidgetBodyProps) {
  const kind = widgetNamespace(widget);
  return <HomeTags tags={widget.tags} empty={`No ${kind} tag has a task yet. A tag’s tasks are those that carry it, or sit under a heading or in a note that does.`} />;
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
      empty="Hover a tagged line in a note and choose Pin to Home, or right-click a search result."
      actionFor={(note) => <RowAction action="unpin-note" attributes={{ 'data-pin-key': note.pinKey || '' }} label="×" title={`Unpin ${note.title}`} />}
    />
  );
}

/**
 * One open question: its words, which open its line, its age and tag, and
 * Answer…; under it, the line that may answer it, which opens, with Use as
 * answer and Not it. Under Zen its buttons are quiet until it is pointed at.
 */
function QuestionItem({ question }: { readonly question: DashboardWidgetQuestion }) {
  const id = { 'data-question-id': question.id, 'data-zen-reveal': '' };
  const offer = question.offer;
  return (
    <div class="home-question" data-zen-region="">
      <WithRowAction
        row={<HomeRow action="open-source" attributes={{ 'data-file-path': question.filePath, 'data-line': question.line }} label={question.text} detail={question.detail} detailKind="count" />}
        action={<RowAction action="answer-question" attributes={id} label="Answer…" title={`Answer ${question.text}`} />}
      />
      {offer
        ? (
          <div class="home-question-offer">
            <button type="button" class="home-question-offer-line" data-action="open-source" data-file-path={offer.filePath} data-line={offer.line} data-tip={`Open the line that may answer it: ${offer.text}`}>
              <span class="home-question-offer-where">{`May answer: ${offer.where}`}</span>
              <span class="home-question-offer-text">{offer.text}</span>
            </button>
            <RowAction action="use-offer" attributes={id} label="Use as answer" title="Write this line under the question, with a link to it" />
            <RowAction action="not-it" attributes={id} label="Not it" title="Set this line aside for this question" />
          </div>
        )
        : null}
    </div>
  );
}

/** The open questions, oldest first, each with the line that may answer it. */
function OpenQuestionsBody({ widget }: WidgetBodyProps) {
  const questions = widget.questions || [];
  if (!questions.length) {
    return <EmptyLine text="No open questions. Write one as - [?] …" />;
  }
  return <div class="home-list">{questions.map((question) => <QuestionItem key={question.id} question={question} />)}</div>;
}

/** What one saved search finds: its notes and its open tasks, or its tasks alone for one saved on the Task Board. */
function SavedQueryBody({ widget }: WidgetBodyProps) {
  if (widget.missing) {
    return <EmptyState class="home-widget-empty" state="This saved search was removed." action={<button type="button" data-action="customize-home">Pick another</button>} />;
  }
  // A search saved on the Task Board finds tasks alone.
  if (widget.savedPage === 'taskBoard') {
    return <HomeTasks tasks={widget.tasks} empty="No open tasks match." />;
  }
  return (
    <>
      <h3 class="home-widget-group">{'Notes '}<span class="tag-count">{widget.noteTotal || 0}</span></h3>
      <HomeNotes notes={widget.notes} empty="No notes match." />
      <h3 class="home-widget-group">{'Open tasks '}<span class="tag-count">{widget.total || 0}</span></h3>
      <HomeTasks tasks={widget.tasks} empty="No open tasks match." />
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
  todayNote: TodayNoteBody,
  quietPeople: QuietPeopleBody,
  progress: ProgressBody,
  pinnedNotes: PinnedNotesBody,
  savedQuery: SavedQueryBody,
  openQuestions: OpenQuestionsBody,
};

/** What one widget shows; nothing for a kind this page does not know. */
export function WidgetBody(props: WidgetBodyProps) {
  const body = Object.hasOwn(BODIES, props.widget.kind) ? BODIES[props.widget.kind] : undefined;
  return body ? <>{body(props)}</> : null;
}
