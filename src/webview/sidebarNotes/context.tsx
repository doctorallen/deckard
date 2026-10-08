/**
 * What the sidebar is about, above its list: the note or entry it ranks
 * for, with the note's own tags, or the page in front; and, for the related
 * notes, how they are sorted and the gear.
 */
import type { SidebarNotesSnapshot, SidebarTag } from '../../ui/protocol/sidebarNotes';
import { ViewOptionChoices, ViewOptions } from '../shared/viewOptions';
import { SelectedGraphNode } from './cards';
import { ACTIVE_TAG_PAGE_SIZE, previewLines } from './model';
import { ActiveTag } from './weights';

/**
 * The note's own tags. They are context for the list below them, so only
 * the first few are kept on screen, and the rest are one press away: a note
 * with a dozen tags used to push every related note out of view.
 */
function ActiveTagList({ tags, showEvery }: { readonly tags: readonly SidebarTag[]; readonly showEvery: boolean }) {
  if (!tags.length) {
    return null;
  }
  const shown = showEvery ? tags : tags.slice(0, ACTIVE_TAG_PAGE_SIZE);
  const hidden = tags.length - shown.length;
  return (
    <div class="active-tag-list" aria-label="Active note tags">
      {shown.map((tag) => <ActiveTag tag={tag} />)}
      {hidden > 0
        ? <button type="button" class="clear-entry-context" data-action="show-every-active-tag">{`Show ${hidden} more ${hidden === 1 ? 'tag' : 'tags'}`}</button>
        : null}
    </div>
  );
}

/** A page in front, named as the sidebar's context: what it is, over what the sidebar shows of it. */
function PageInFront({ label, name }: { readonly label: string; readonly name: string }) {
  return (
    <div class="active-file">
      <div class="active-label">{label}</div>
      <div class="active-name">{name}</div>
    </div>
  );
}

/** What the sidebar draws its context with. */
export interface ContextProps {
  readonly snapshot: SidebarNotesSnapshot;
  /** Whether the entry ranked from is unfolded. */
  readonly open: boolean;
  /** Whether every one of the note's tags is listed. */
  readonly showEveryActiveTag: boolean;
}

/**
 * What the sidebar is about. The entry being ranked from, and its tags, are
 * context: folded by default so the related notes start at the top of a
 * short pane, and the fold is remembered. A page in front names itself;
 * Refine names its search in its own heading.
 */
export function Context({ snapshot, open, showEveryActiveTag }: ContextProps) {
  if (snapshot.state === 'refine') {
    return null;
  }
  if (snapshot.state === 'calendarDay') {
    return <PageInFront label="Calendar" name="The chosen day" />;
  }
  if (snapshot.state === 'graph') {
    const node = snapshot.graph && snapshot.graph.selectedNode;
    return node ? <SelectedGraphNode node={node} /> : <PageInFront label="Notes Graph" name="Connected nodes" />;
  }
  if (!snapshot.activeFileName) {
    return null;
  }
  return (
    <details class="active-file" open={open}>
      <summary class="active-summary">
        <span class="active-label">{snapshot.activeEntryTitle ? 'Selected note' : 'Current note'}</span>
        <span class="active-name">{snapshot.activeEntryTitle || snapshot.activeFileName}</span>
      </summary>
      {snapshot.activeEntryTitle ? <button class="clear-entry-context" data-action="clear-entry-related-notes">Show whole document</button> : null}
      <ActiveTagList tags={snapshot.activeTags} showEvery={showEveryActiveTag} />
    </details>
  );
}

/** How the related notes can be ordered, as the select lists them. */
const SORT_MODES: ReadonlyArray<readonly [NonNullable<SidebarNotesSnapshot['relatedNotesSortMode']>, string]> = [
  ['tags', 'Relevance'],
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['access', 'Most accessed'],
];

/**
 * The Related notes heading, with a compact Sort at it and the gear: how
 * many lines of each excerpt, and whether daily notes are listed. The
 * heading is drawn once there are related notes.
 */
export function RelatedNotesControls({ snapshot, heading }: { readonly snapshot: SidebarNotesSnapshot; readonly heading: boolean }) {
  const mode = snapshot.relatedNotesSortMode;
  return (
    <div class="related-notes-controls">
      {heading ? <span class="section-label">Related notes</span> : null}
      <label class="related-notes-sort-control">
        {'Sort:'}
        <select class="related-notes-sort" data-action="set-related-notes-sort" aria-label="Sort related notes">
          {SORT_MODES.map(([value, text]) => <option value={value} selected={mode === value}>{text}</option>)}
        </select>
      </label>
      <ViewOptions
        groups={[
          {
            label: 'Preview',
            content: <ViewOptionChoices action="set-preview-lines" choices={[[0, 'None', 'No preview'], [1, '1 line', 'One line'], [2, '2 lines', 'Two lines']]} selected={previewLines(snapshot)} label="Preview lines" />,
          },
          {
            label: 'Daily notes',
            content: <ViewOptionChoices action="set-hide-daily" choices={[['show', 'Show', 'Show daily notes'], ['hide', 'Hide', 'Hide daily, weekly, and monthly notes, which link to everything written that day']]} selected={snapshot.hideDailyNotes ? 'hide' : 'show'} label="Daily notes" />,
          },
        ]}
      />
    </div>
  );
}
