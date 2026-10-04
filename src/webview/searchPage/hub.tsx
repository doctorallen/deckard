/**
 * What a tag's page shows above its results: the note that describes the
 * tag, and the quiet lines on how else the tag is reached.
 */
import type { ComponentChild } from 'preact';

import type { SearchPageSnapshot, SearchPageTag, SearchPageTagNotes, TagOverviewHub } from '../../ui/protocol/searchPage';
import { ProgressBar } from '../shared/progressBar';
import { ProgressWords } from '../shared/progressWords';
import { NoteBody } from '../shared/searchCard';
import { TagButton } from '../shared/tagButton';
import { isParkedTag } from '../shared/tagMenu';

/**
 * A property's values joined by commas, a tag as the control that opens
 * it, each run of words one text node, as the template wrote them: Chrome
 * lays out the edge between two text nodes apart.
 */
function propertyValues(values: TagOverviewHub['properties'][number]['values']): ComponentChild[] {
  const drawn: ComponentChild[] = [];
  values.forEach((value, index) => {
    const separator = index > 0 ? ', ' : '';
    const last = drawn[drawn.length - 1];
    if (value.tag) {
      if (typeof last === 'string') {
        drawn[drawn.length - 1] = last + separator;
      } else if (separator) {
        drawn.push(separator);
      }
      drawn.push(<TagButton tag={value.tag} className="inline-tag" />);
    } else if (typeof last === 'string') {
      drawn[drawn.length - 1] = last + separator + value.text;
    } else {
      drawn.push(separator + value.text);
    }
  });
  return drawn;
}

/** The hub note's front-matter properties, a tag among their values drawn as the control that opens it. */
function HubProperties({ hub }: { readonly hub: TagOverviewHub }) {
  return (
    <dl class="hub-properties">
      {hub.properties.map((property) => (
        <div>
          <dt>{property.name}</dt>
          <dd>{propertyValues(property.values)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The other notes that describe the tag, each a button that opens it. */
function OtherHubNotes({ filePaths }: { readonly filePaths: readonly string[] }) {
  return (
    <p class="hub-note">
      {'Also described by '}
      {filePaths.map((filePath, index) => [
        index > 0 ? ' ' : null,
        <button data-action="open-source" data-file-path={filePath} data-line="1">{filePath.split('/').pop() || filePath}</button>,
      ])}
      {'. The first by path is shown.'}
    </p>
  );
}

/**
 * The note that describes the page's tag, open or closed as the reader
 * left it, or as `deckard.tagOverview.hubNoteExpanded` says until they do.
 */
export function HubNote({ snapshot, hubOpen }: { readonly snapshot: SearchPageSnapshot; readonly hubOpen: boolean | undefined }) {
  const hub = snapshot.hub;
  if (!snapshot.tag || !hub) {
    return null;
  }
  const open = hubOpen === undefined ? hub.expanded !== false : hubOpen;
  return (
    <details class="hub" open={open}>
      <summary class="hub-header">
        <span class="hub-title"><span class="hub-toggle" aria-hidden="true"></span><span class="eyebrow">Hub note</span></span>
        <button data-action="open-source" data-file-path={hub.filePath} data-line="1" data-tip={hub.filePath}>{`Open ${hub.fileName}`}</button>
      </summary>
      {hub.properties.length ? <HubProperties hub={hub} /> : null}
      {hub.rawContent.trim() ? <NoteBody rawContent={hub.rawContent} blocks={hub.bodyTokens} renderMode={snapshot.renderMode} /> : null}
      {hub.otherFilePaths.length ? <OtherHubNotes filePaths={hub.otherFilePaths} /> : null}
    </details>
  );
}

/**
 * How far along the tag's tasks are: a bar and the words, where "3 of 8
 * done", "1 overdue", "1 needs a new date", and "next due today" are each a
 * link that searches those tasks. Only a tag that finds a task has it.
 */
export function TagProgress({ snapshot }: { readonly snapshot: SearchPageSnapshot }) {
  const progress = snapshot.tag && snapshot.tagPage ? snapshot.tagPage.progress : undefined;
  if (!progress) {
    return null;
  }
  return (
    <div class="tag-progress">
      <span class="eyebrow">Progress</span>
      <ProgressBar done={progress.done} total={progress.total} />
      <span class="tag-progress-label">
        <ProgressWords parts={progress.parts} action="search-progress" attributes={(_part, at) => ({ 'data-part': at })} />
      </span>
    </div>
  );
}

/** Said when the page's tag is parked, with the way to unpark it. */
function ParkedNote({ tag }: { readonly tag: SearchPageTag }) {
  return (
    <p class="tag-note">
      <strong>Parked.</strong>
      {' Its notes and tasks are left out of the Tasks view, the Task board, and Related Notes. '}
      <button type="button" class="tag-note-action" data-action="unpark-tag" data-tag-key={tag.key} data-tip={`Take ${tag.label} out of the parked tags`}>Unpark</button>
    </p>
  );
}

/** Another spelling of the tag: open it, search for both, or merge them. */
function LookalikeNote({ tag, other }: { readonly tag: SearchPageTag; readonly other: SearchPageTagNotes['lookalikes'][number] }) {
  const labelOf = (key: string): string => (key === other.key ? other.label : tag.label);
  return (
    <p class="tag-note">
      {'Also written as '}
      <button type="button" class="tag-note-tag" data-action="open-tag" data-tag-key={other.key} data-tip={`Open ${other.label}`}>{other.label}</button>
      {` (${other.count} ${other.count === 1 ? 'entry' : 'entries'}). `}
      <button type="button" class="tag-note-action" data-action="include-lookalike" data-tag-key={other.key} data-tip="Search for both spellings">Include in search</button>
      {' '}
      <button
        type="button"
        class="tag-note-action"
        data-action="merge-lookalike"
        data-source-key={other.sourceKey}
        data-target-key={other.targetKey}
        data-tip={`Merge ${labelOf(other.sourceKey)} into ${labelOf(other.targetKey)}, after showing what changes`}
      >
        Merge
      </button>
    </p>
  );
}

/** Entries listed because they link to the hub note without the tag, and the way to leave them out. */
function HubLinksNote({ count, title }: { readonly count: number; readonly title: string }) {
  return (
    <p class="tag-note">
      {`Also listing ${count} ${count === 1 ? 'entry that links' : 'entries that link'} to ${title} without the tag. `}
      <button type="button" class="tag-note-action" data-action="exclude-hub-links" data-tip="List only the entries that carry the tag">Leave them out</button>
    </p>
  );
}

/** Entries that write the tag's name as a plain word, and the way to list them. */
function MentionNote({ mention }: { readonly mention: NonNullable<SearchPageTagNotes['mention']> }) {
  return (
    <p class="tag-note">
      {`${mention.count} ${mention.count === 1 ? 'entry mentions' : 'entries mention'} "${mention.word}" without the tag. `}
      <button type="button" class="tag-note-action" data-action="show-mentions" data-tip="Search for them; Bulk edit → Add a tag tags them all">Show them</button>
    </p>
  );
}

/**
 * Where a tag page's name is written without the tag, with the way to list
 * those entries, for the top of Refine, where it is not lost among the
 * notes under the hub. Undefined for a page with none.
 */
export function tagMentionLine(snapshot: SearchPageSnapshot): ComponentChild | undefined {
  const mention = snapshot.tag ? snapshot.tagPage?.mention : undefined;
  return mention && mention.count > 0 ? <MentionNote mention={mention} /> : undefined;
}

/**
 * The quiet lines under a tag's page's hub: whether the tag is parked, its
 * other spellings, and what only links its hub. Only a one-tag page has
 * them, and nothing when none applies.
 */
export function TagNotes({ snapshot }: { readonly snapshot: SearchPageSnapshot }) {
  const tag = snapshot.tag;
  const page = snapshot.tagPage;
  if (!tag || !page) {
    return null;
  }
  const notes = [
    isParkedTag(tag.key) ? <ParkedNote key="parked" tag={tag} /> : null,
    ...(page.lookalikes || []).map((other) => <LookalikeNote key={`lookalike:${other.key}`} tag={tag} other={other} />),
    page.hubLinkCount > 0 && page.hubTitle ? <HubLinksNote key="hub-links" count={page.hubLinkCount} title={page.hubTitle} /> : null,
  ].filter(Boolean);
  return notes.length ? <div class="tag-notes">{notes}</div> : null;
}
