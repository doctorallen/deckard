/**
 * The top of a search page: what it is about, with its saved name and the
 * offer of a hub note, and its bar's ‹ › and ⋯.
 */
import type { ComponentChildren } from 'preact';

import type { SearchPageSnapshot } from '../../ui/protocol/searchPage';
import type { TagReference } from '../../ui/protocol/shared';
import { IconButton } from '../shared/buttons';
import { PageBar } from '../shared/pageBar';
import { LayoutSplitIcon, LayoutTabsIcon, RenderedIcon, SourceIcon } from '../shared/strokeIcons';
import { TagLabel } from '../shared/tagLabel';
import { resultCounts } from './results';
import { type ViewOptionGroup, type ViewOptionItem, ViewOptionChoices } from '../shared/viewOptions';

/** A built-in or user-made namespace and its name in one readable title form: "Project: Atlas". */
export function formatEntityTitle(kind: string, name: string): string {
  const formatPart = (value: string): string => String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
  return `${formatPart(kind)}: ${formatPart(name)}`;
}

/** The page's title, or a tag under it, as the control that opens the tag's page. */
function OverviewTagLink({ tag, text }: { readonly tag: TagReference; readonly text: string }) {
  return (
    <button class="overview-tag-link note-text" data-action="open-tag" data-tag-key={tag.key} aria-label={`Open ${tag.label} overview`}>
      <TagLabel label={text} />
    </button>
  );
}

/**
 * Back and forward through the searches this page has shown, as a
 * browser's are. The mouse's own buttons already did this; nothing on the
 * page said so, and the keyboard could not.
 */
function HistoryButtons({ history }: { readonly history: SearchPageSnapshot['history'] }) {
  const steps = history || { back: false, forward: false };
  return (
    <span class="history-buttons" role="group" aria-label="Search history">
      <IconButton action="history-back" label="Back to the search before" tipKey="Alt+←" icon="‹" disabledReason={steps.back ? '' : 'No search before this one'} />
      <IconButton action="history-forward" label="Forward to the search after" tipKey="Alt+→" icon="›" disabledReason={steps.forward ? '' : 'No search after this one'} />
    </span>
  );
}

/** One of a pair of icon toggles, such as Tabs and Side by side. */
interface ToggleChoice {
  readonly value: string;
  readonly label: string;
  readonly tip: string;
  readonly icon: ComponentChildren;
}

/** A pair of icon toggles in ⋯, the one in use pressed. */
function IconToggles({ action, attribute, current, label, extraClass, choices }: {
  readonly action: string;
  /** The data attribute each toggle carries its value in. */
  readonly attribute: string;
  readonly current: string;
  readonly label: string;
  readonly extraClass?: string;
  readonly choices: readonly ToggleChoice[];
}) {
  return (
    <div class={`segmented toolbar-toggle-group${extraClass ? ` ${extraClass}` : ''}`} role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          class={`icon-button toolbar-toggle ${current === choice.value ? 'active' : ''}`}
          data-action={action}
          {...{ [attribute]: choice.value }}
          aria-label={choice.label}
          aria-pressed={current === choice.value}
          data-tip={choice.tip}
        >
          {choice.icon}
        </button>
      ))}
    </div>
  );
}

/** How many columns a kind of result is laid out in, from one to four. */
function ColumnChoices({ section, selected }: { readonly section: 'notes' | 'tasks'; readonly selected: number }) {
  const choices = [1, 2, 3, 4].map((columns) => [columns, String(columns), `${columns} columns`] as const);
  return (
    <ViewOptionChoices
      action="set-columns"
      choices={choices}
      selected={selected}
      label={`${section === 'notes' ? 'Note' : 'Task'} columns`}
      attributes={{ 'data-section': section }}
    />
  );
}

/**
 * Save search…, ⋯'s first row: names the search in the box and keeps it on
 * Home. Held until there is a search to save, and let go as the reader
 * types, as every control that needs text is.
 */
function saveSearchRow(hasText: boolean): ViewOptionItem {
  return {
    action: 'save-filter',
    text: 'Save search…',
    tip: 'Keep this search, named, on Home',
    disabledReason: hasText ? undefined : 'Type a search to save it',
    attributes: { 'data-query-needs-text': '', 'data-tip-disabled': 'Type a search to save it' },
  };
}

/**
 * Export notes… and Export tasks…, after Save search…, each while its kind
 * has results: rare, and output only, so in ⋯ as on the Task board, rather
 * than beside each pane.
 */
function exportRows(snapshot: SearchPageSnapshot): ViewOptionItem[] {
  const counts = resultCounts(snapshot);
  const rows: ViewOptionItem[] = [];
  if (counts.notes) {
    rows.push({ action: 'export-results', text: 'Export notes…', tip: 'Export these notes as a Markdown table, a list, or CSV: copy, or save to a file', attributes: { 'data-kind': 'notes' } });
  }
  if (counts.tasks) {
    rows.push({ action: 'export-results', text: 'Export tasks…', tip: 'Export these tasks as a Markdown table, a list, or CSV: copy, or save to a file', attributes: { 'data-kind': 'tasks' } });
  }
  return rows;
}

/** ⋯'s view rows: layout, grouping, format, preview, and columns, as the gear held them; Sort is beside the notes. */
function searchView(snapshot: SearchPageSnapshot): ViewOptionGroup[] {
  return [
    {
      label: 'Layout',
      content: (
        <IconToggles action="set-layout" attribute="data-layout" current={snapshot.layout} label="Content layout" extraClass="layout-toggle-group" choices={[
          { value: 'tabs', label: 'Tabs layout', tip: 'Tabs: switch between Notes and Tasks', icon: <LayoutTabsIcon /> },
          { value: 'split', label: 'Side-by-side layout', tip: 'Side by side: Notes 60%, Tasks 40%', icon: <LayoutSplitIcon /> },
        ]} />
      ),
    },
    {
      label: 'Group by',
      content: (
        <ViewOptionChoices
          action="set-hierarchy"
          choices={[['off', 'None', 'None, the results ungrouped'], ['tags', 'Tag', "Tag, under Refine's tags"], ['headings', 'Heading', 'Heading, nested by tagged headings']]}
          selected={snapshot.hierarchy || 'off'}
          label="Group the results by"
        />
      ),
    },
    {
      label: 'Format',
      content: (
        <IconToggles action="set-mode" attribute="data-mode" current={snapshot.renderMode} label="Content format" choices={[
          { value: 'markdown', label: 'Source view', tip: 'Source: show the original Markdown', icon: <SourceIcon /> },
          { value: 'html', label: 'Rendered view', tip: 'Rendered: show formatted Markdown', icon: <RenderedIcon /> },
        ]} />
      ),
    },
    { label: 'Preview', content: <ViewOptionChoices action="set-preview" choices={[['none', 'None'], ['lines', '3 lines'], ['full', 'Full']]} selected={snapshot.preview || 'lines'} label="Result preview" /> },
    { label: 'Note columns', content: <ColumnChoices section="notes" selected={snapshot.noteColumns} /> },
    { label: 'Task columns', content: <ColumnChoices section="tasks" selected={snapshot.taskColumns} /> },
  ];
}

/**
 * The bar: one name for the place whatever it searches, a saved search's
 * name, the title (the entity or tag the page is about, as the control
 * that opens it, or Search), the entity's tag under it, and a link
 * offering a hub note when no note describes the tag; then ‹ › and ⋯.
 * The link is never in ⋯, and Zen draws it as it is: it also says the
 * tag has no hub.
 */
export function PageHeader({ snapshot, hasText }: { readonly snapshot: SearchPageSnapshot; readonly hasText: boolean }) {
  const entity = snapshot.entity;
  const focus = entity ? { key: entity.key, label: entity.label } : snapshot.tag;
  let title = 'Search';
  if (entity) {
    title = formatEntityTitle(entity.kind, entity.name);
  } else if (snapshot.tag) {
    title = snapshot.tag.label;
  }
  const tag = snapshot.tag;
  return (
    <PageBar
      trail="SEARCH PAGE"
      label="Search page"
      lead={(
        <>
          {snapshot.savedViewName
            ? <div class="saved-view-name" aria-label={`Saved search: ${snapshot.savedViewName}`}><span class="saved-view-name-label">Saved search:</span>{` ${snapshot.savedViewName}`}</div>
            : null}
          <h1 aria-label={title}>{focus ? <OverviewTagLink tag={focus} text={title} /> : title}</h1>
          {entity && focus ? <div class="entity-meta"><OverviewTagLink tag={focus} text={entity.label} /></div> : null}
          {tag && !snapshot.hub
            ? <p class="hub-offer"><button type="button" class="hub-offer-link" data-action="create-hub" data-tip={`Create a note whose describes: front matter names ${tag.label}`}>Create hub note</button></p>
            : null}
        </>
      )}
      controls={<HistoryButtons history={snapshot.history} />}
      menu={{ actions: [saveSearchRow(hasText), ...exportRows(snapshot)], view: searchView(snapshot), pageWidth: true, keySheet: true }}
    />
  );
}
