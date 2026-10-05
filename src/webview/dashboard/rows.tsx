/**
 * The rows Home's widgets list: tags, notes, searches, saved searches, two
 * tags written together, and tasks, each a control that opens what it
 * names, some with a button of their own beside them.
 */
import type { ComponentChild, ComponentChildren } from 'preact';

import type { DashboardSavedFilter, DashboardWidgetNote, DashboardWidgetTag, DashboardWidgetTagPair } from '../../ui/protocol/dashboard';
import type { DashboardTask, TagTitleDisplayMode } from '../../ui/protocol/shared';
import { ProgressBar } from '../shared/progressBar';
import { TagLabel } from '../shared/tagLabel';
import { TaskListRow } from '../shared/taskRow';

/** Attributes an element carries besides its own, by name. */
export type Attributes = Readonly<Record<string, string | number>>;

/** A row that opens something: what it does, the attributes that say what, its label, and a readout. */
interface HomeRowProps {
  readonly action: string;
  readonly attributes: Attributes;
  readonly label: ComponentChildren;
  readonly detail?: string;
  /** What the readout is: where a note is written, which File & line governs, or a count, which Counts does. */
  readonly detailKind: 'file' | 'count';
  /** How far along what the row names is, drawn as a bar between its label and its detail. */
  readonly progress?: { readonly done: number; readonly total: number };
}

/** A row that opens something: a tag, a search, or a note. */
export function HomeRow({ action, attributes, label, detail, detailKind, progress }: HomeRowProps) {
  return (
    <button type="button" class={progress ? 'row saved-filter-row home-row has-progress' : 'row saved-filter-row home-row'} data-action={action} data-tip-around="" {...attributes}>
      <span class="home-row-label">{label}</span>
      {progress ? <ProgressBar done={progress.done} total={progress.total} /> : null}
      {detail ? <span class={`home-row-detail is-${detailKind}`}>{detail}</span> : null}
    </button>
  );
}

/** A button beside a row, which does one thing to what the row names. */
interface RowActionProps {
  readonly action: string;
  readonly attributes: Attributes;
  readonly label: string;
  /** What it does, as its tip and its accessible name. */
  readonly title: string;
}

/** A button beside a row, such as Create hub beside a tag with none. */
export function RowAction({ action, attributes, label, title }: RowActionProps) {
  return <button type="button" class="home-row-action" data-action={action} {...attributes} data-tip={title} aria-label={title}>{label}</button>;
}

/** A row, and beside it a button of its own when there is one. */
function WithRowAction({ row, action }: { readonly row: ComponentChild; readonly action: ComponentChild }) {
  return action ? <div class="home-row-with-action">{row}{action}</div> : <>{row}</>;
}

/** What a widget says when its list is empty. */
export function EmptyLine({ text }: { readonly text: string }) {
  return <p class="home-widget-empty">{text || null}</p>;
}

/** The searches a page lists, or a line with a way to a search page when there are none. */
export function OpenSearchPageLine({ text }: { readonly text: string }) {
  return <p class="home-widget-empty">{text}<button type="button" data-action="open-search-page">Open a search page</button></p>;
}

/** Tags that open their page; `actionFor` adds a button beside a tag. */
export function HomeTags(props: {
  readonly tags: readonly DashboardWidgetTag[] | undefined;
  readonly empty: string;
  readonly actionFor?: (tag: DashboardWidgetTag) => ComponentChild;
}) {
  const { tags, empty, actionFor } = props;
  if (!tags || !tags.length) {
    return <EmptyLine text={empty} />;
  }
  return (
    <div class="home-list">
      {tags.map((tag) => (
        <WithRowAction
          key={tag.key}
          row={<HomeRow action="open-tag" attributes={{ 'data-tag-key': tag.key }} label={<TagLabel label={tag.label} />} detail={tag.detail} detailKind="count" progress={tag.progress} />}
          action={actionFor ? actionFor(tag) : null}
        />
      ))}
    </div>
  );
}

/** Notes that open at their line; `actionFor` adds a button beside a note. */
export function HomeNotes(props: {
  readonly notes: readonly DashboardWidgetNote[] | undefined;
  readonly empty: string;
  readonly actionFor?: (note: DashboardWidgetNote) => ComponentChild;
}) {
  const { notes, empty, actionFor } = props;
  if (!notes || !notes.length) {
    return <EmptyLine text={empty} />;
  }
  return (
    <div class="home-list">
      {notes.map((note, position) => (
        <WithRowAction
          key={`${position}:${note.filePath}:${note.line}`}
          row={<HomeRow action="open-source" attributes={{ 'data-file-path': note.filePath, 'data-line': note.line }} label={note.title} detail={note.detail} detailKind="file" />}
          action={actionFor ? actionFor(note) : null}
        />
      ))}
    </div>
  );
}

/** Tasks as a list draws them, each opening at its line. */
export function HomeTasks(props: {
  readonly tasks: readonly DashboardTask[] | undefined;
  readonly empty: string;
  readonly titleDisplay: TagTitleDisplayMode;
}) {
  const { tasks, empty, titleDisplay } = props;
  if (!tasks || !tasks.length) {
    return <EmptyLine text={empty} />;
  }
  return <div class="task-list">{tasks.map((item) => <TaskListRow key={item.task.id} item={item} titleDisplay={titleDisplay} />)}</div>;
}

/** Two tags written together, each pair opening a search for both. */
export function TagPairs({ pairs }: { readonly pairs: readonly DashboardWidgetTagPair[] | undefined }) {
  if (!pairs || !pairs.length) {
    return <EmptyLine text="Two tags carried by the same note or task show up here." />;
  }
  return (
    <div class="home-list">
      {pairs.map((pair) => {
        const query = `${pair.tags[0].key} AND ${pair.tags[1].key}`;
        return (
          <button key={query} type="button" class="row saved-filter-row home-row" data-action="open-search" data-query={query} data-tip-around="" data-tip={`${pair.detail}. Search for both.`}>
            <span class="home-row-label">
              <span class="home-tag-pair"><TagLabel label={pair.tags[0].label} /><span class="home-tag-pair-join">+</span><TagLabel label={pair.tags[1].label} /></span>
            </span>
            <span class="home-row-detail is-count">{`${pair.count}× · ${Math.round(pair.overlap * 100)}%`}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What a saved search finds, under its name: its search, or its tags joined by AND. */
function SavedFilterCriteria({ filter }: { readonly filter: DashboardSavedFilter }) {
  if (filter.query) {
    return <>{`${filter.page === 'taskBoard' ? 'Task Board · ' : ''}${filter.query}`}</>;
  }
  const parts: ComponentChild[] = [];
  filter.tags.forEach((tag, position) => {
    if (position > 0) {
      parts.push(' AND ');
    }
    parts.push(<TagLabel label={tag.label} />);
  });
  parts.push(` · ${filter.tags.length} tags`);
  return <>{parts}</>;
}

/**
 * A saved search, which opens where it was saved, with Remove and, when
 * Home does not list it yet, an offer to list what it finds there.
 */
export function SavedFilterRow({ filter }: { readonly filter: DashboardSavedFilter }) {
  // The criteria are the row's own child, not wrapped with the name: the
  // frame they open in is inherited, and a wrapper has none to give.
  return (
    <div class="row saved-filter-row" tabIndex={0} data-tip-around="" data-saved-filter-id={filter.id}>
      <div class="saved-filter-name">{filter.name}</div>
      <span class="saved-filter-actions">
        {/* A search Home does not list yet offers to list it there. */}
        {filter.onHome
          ? null
          : <button type="button" class="saved-filter-show" data-action="add-saved-search-widget" data-saved-filter-id={filter.id} data-tip="Add a widget to Home that lists what this search finds" aria-label={`Show the results of ${filter.name} on Home`}>Show results</button>}
        <button class="saved-filter-remove" data-action="remove-saved-filter" data-saved-filter-id={filter.id} aria-label={`Remove saved search ${filter.name}`}>Remove</button>
      </span>
      <div class="saved-filter-tags"><SavedFilterCriteria filter={filter} /></div>
    </div>
  );
}

/** Saved searches, each a row. */
export function SavedFilterList({ filters }: { readonly filters: readonly DashboardSavedFilter[] }) {
  return <div class="saved-filter-list">{filters.map((filter) => <SavedFilterRow key={filter.id} filter={filter} />)}</div>;
}
