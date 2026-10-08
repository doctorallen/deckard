/**
 * The top of a search page: what it is about, with its saved name and the
 * offer of a hub note, and its toolbar of history, Help, and the gear.
 */
import type { ComponentChildren } from 'preact';

import { NOTE_SORT_LABELS } from '../../domain/model/sortOrders';
import type { SearchPageSnapshot } from '../../ui/protocol/searchPage';
import type { TagReference } from '../../ui/protocol/shared';
import { HelpButton, IconButton } from '../shared/buttons';
import { Eyebrow } from '../shared/eyebrow';
import { LayoutSplitIcon, LayoutTabsIcon, RenderedIcon, SortIcon, SourceIcon } from '../shared/strokeIcons';
import { TagLabel } from '../shared/tagLabel';
import { pageWidthOption, themeOption, ViewOptionChoices, ViewOptions, zenOption } from '../shared/viewOptions';

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

/** How the notes are ordered, in the gear: the select alone, its label being the row's. */
function SortControl({ mode }: { readonly mode: SearchPageSnapshot['sortMode'] }) {
  const options = Object.entries(NOTE_SORT_LABELS);
  return (
    <label class="control-label">
      <span class="control-icon">
        <select data-action="set-sort" aria-label="Sort notes">
          {options.map(([value, text]) => <option value={value} selected={mode === value}>{text}</option>)}
        </select>
        <SortIcon />
      </span>
    </label>
  );
}

/** One of a pair of icon toggles, such as Tabs and Side by side. */
interface ToggleChoice {
  readonly value: string;
  readonly label: string;
  readonly tip: string;
  readonly icon: ComponentChildren;
}

/** A pair of icon toggles in the gear, the one in use pressed. */
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

/** The gear: sort, layout, grouping, format, preview, columns, theme, and zen. */
function SearchViewOptions({ snapshot }: { readonly snapshot: SearchPageSnapshot }) {
  return (
    <ViewOptions
      groups={[
        { label: 'Sort', content: <SortControl mode={snapshot.sortMode} /> },
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
        themeOption(),
        pageWidthOption(),
        zenOption(),
      ]}
    />
  );
}

/**
 * The header: one name for the place whatever it searches, a saved
 * search's name, the title (the entity or tag the page is about, as the
 * control that opens it, or Search), the entity's tag under it, and a line
 * offering a hub note when no note describes the tag; then the toolbar.
 */
export function PageHeader({ snapshot }: { readonly snapshot: SearchPageSnapshot }) {
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
    <header>
      <div>
        <div class="overview-eyebrow"><Eyebrow trail="SEARCH PAGE" /></div>
        {snapshot.savedViewName
          ? <div class="saved-view-name" aria-label={`Saved search: ${snapshot.savedViewName}`}><span class="saved-view-name-label">Saved search:</span>{` ${snapshot.savedViewName}`}</div>
          : null}
        <h1 aria-label={title}>{focus ? <OverviewTagLink tag={focus} text={title} /> : title}</h1>
        {entity && focus ? <div class="entity-meta"><OverviewTagLink tag={focus} text={entity.label} /></div> : null}
        {tag && !snapshot.hub
          ? <p class="hub-offer"><button type="button" class="hub-offer-button" data-action="create-hub" data-tip={`Create a note whose describes: front matter names ${tag.label}`}>Create hub note</button></p>
          : null}
      </div>
      <div class="toolbar" role="group" aria-label="View options">
        <HistoryButtons history={snapshot.history} />
        <HelpButton anchor="search" />
        <SearchViewOptions snapshot={snapshot} />
      </div>
    </header>
  );
}
