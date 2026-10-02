/**
 * What points at the note being read: the notes that link to it, each with
 * its lines under their headings, and the notes that name it without a
 * link, each of which can be made one here or all at once.
 */
import type { ComponentChildren } from 'preact';

import type { NoteLinkEntry, NoteLinkGroup, NoteLinks, NoteMention } from '../../ui/protocol/sidebarNotes';
import { ChevronRightIcon } from '../shared/strokeIcons';

/** Which Links groups are open, and which link rows are unfolded onto their section. */
export interface LinksView {
  readonly open: { readonly linked: boolean; readonly mentions: boolean };
  /** The rows unfolded, by `filePath:line`. */
  readonly openSections: ReadonlySet<string>;
}

/** What a link row is drawn with. */
interface LinkRowProps {
  readonly entry: NoteLinkEntry;
  readonly view: LinksView;
  /** What follows the line, such as a mention's Link. */
  readonly extra?: ComponentChildren;
  /** Whether the row names the note the line is in. */
  readonly withTitle?: boolean;
}

/**
 * One line that links to or names the note: it opens where it is, and
 * unfolds onto the rest of its section when there is more of it.
 */
function LinkRow({ entry, view, extra, withTitle }: LinkRowProps) {
  const key = `${entry.filePath}:${entry.line}`;
  const expanded = Boolean(entry.sectionText) && view.openSections.has(key);
  return (
    <li class="link-row">
      <div class="link-line">
        <button type="button" class="link-open" data-action="open-link" data-file-path={entry.filePath} data-line={entry.line} data-tip="Open this line. Cmd/Ctrl-click to open it beside the note.">
          {withTitle ? <span class="link-note">{entry.title}</span> : null}
          {entry.headingPath && entry.headingPath.length ? <span class="link-path">{entry.headingPath.join(' › ')}</span> : null}
          <span class="link-context">{entry.text}</span>
        </button>
        {extra}
        {entry.sectionText
          ? (
            <button type="button" class="link-expand" data-action="toggle-link-section" data-section-key={key} aria-expanded={expanded ? 'true' : 'false'} aria-label="Show the rest of this section" data-tip="Show the rest of this section">
              <ChevronRightIcon />
            </button>
          )
          : null}
      </div>
      {expanded ? <p class="link-section">{entry.sectionText}</p> : null}
    </li>
  );
}

/** One note that links here: its name, which opens it at its first link, how lately it changed, and its lines. */
function LinkGroup({ group, view }: { readonly group: NoteLinkGroup; readonly view: LinksView }) {
  const first = group.entries[0];
  const meta = [group.updatedLabel, group.linkCount > 1 ? `${group.linkCount} links` : '', group.parked ? 'Parked' : ''].filter(Boolean).join(' · ');
  return (
    <section class="link-group" aria-label={group.title}>
      <div class="link-group-head">
        <button type="button" class="link-group-open" data-action="open-link" data-file-path={group.filePath} data-line={first ? first.line : 1} data-tip={`Open ${group.title} at its first link here`}>{group.title}</button>
        {meta ? <span class="link-group-meta">{meta}</span> : null}
      </div>
      <ul class="link-list">{group.entries.map((entry) => <LinkRow entry={entry} view={view} />)}</ul>
    </section>
  );
}

/** Search for every entry that links here, so Refine, Bulk edit, Save, and Export work on them. */
const SEARCH_TIP = 'Search for every entry that links here, so Refine, Bulk edit, Save, and Export work on them';

/** The foot of Linked from: how many lines are not listed, if any, and the search for all of them. */
function LinkedFoot({ links, shownLines }: { readonly links: NoteLinks; readonly shownLines: number }) {
  if (links.linkedFromCount > shownLines) {
    return (
      <p class="links-more">
        {`${links.linkedFromCount - shownLines} more not listed. `}
        <button type="button" class="links-search" data-action="open-links-search" data-tip={SEARCH_TIP}>Open all as a search</button>
      </p>
    );
  }
  return <p class="links-more"><button type="button" class="links-search" data-action="open-links-search" data-tip={SEARCH_TIP}>Open as search</button></p>;
}

/** The notes that link here, newest first, with the daily notes left out said so. */
function LinkedFrom({ links, view }: { readonly links: NoteLinks; readonly view: LinksView }) {
  const groups = links.linkedFromNotes || [];
  const shownLines = groups.reduce((total, group) => total + group.entries.length, 0);
  const hidden = links.hiddenDailyNoteCount || 0;
  return (
    <details class="links-group" data-links-group="linked" open={view.open.linked}>
      <summary>Linked from <span class="links-count">{links.linkedFromNoteCount || groups.length}</span></summary>
      {groups.map((group) => <LinkGroup group={group} view={view} />)}
      <LinkedFoot links={links} shownLines={shownLines} />
      {hidden
        ? (
          <p class="links-more links-hiding">
            {`Hiding ${hidden} daily ${hidden === 1 ? 'note' : 'notes'}. `}
            <button type="button" class="links-search" data-action="show-daily-notes">Show them</button>
          </p>
        )
        : null}
    </details>
  );
}

/** A mention's Link: that mention made a [[link]]. */
function LinkMention({ entry }: { readonly entry: NoteMention }) {
  return (
    <button type="button" class="link-one" data-action="link-mention" data-file-path={entry.filePath} data-line={entry.line} data-start-column={entry.startColumn} aria-label={`Link this mention of ${entry.name} in ${entry.title}`} data-tip="Make this mention a [[link]]">Link</button>
  );
}

/** The notes that name this one without a link, each with Link, and Link all. */
function Mentions({ links, view }: { readonly links: NoteLinks; readonly view: LinksView }) {
  return (
    <details class="links-group" data-links-group="mentions" open={view.open.mentions}>
      <summary>Mentioned without a link <span class="links-count">{links.mentionCount}</span></summary>
      <button type="button" class="link-all" data-action="link-all-mentions" data-tip="Make every mention a [[link]], as one change Undo Last Change takes back">Link all</button>
      <ul class="link-list">
        {links.mentions.map((entry) => <LinkRow entry={entry} view={view} extra={<LinkMention entry={entry} />} withTitle />)}
      </ul>
      {links.mentionCount > links.mentions.length ? <p class="links-more">{`${links.mentionCount - links.mentions.length} more not listed`}</p> : null}
    </details>
  );
}

/**
 * What points at the note, under the related notes: Linked from and
 * Mentioned without a link, each a group that stays as the reader left it.
 * Nothing when nothing does.
 */
export function Links({ links, view }: { readonly links: NoteLinks | undefined; readonly view: LinksView }) {
  if (!links || (!links.linkedFromCount && !links.mentionCount)) {
    return null;
  }
  return (
    <section class="note-links" aria-label="Links to this note">
      {links.linkedFromCount ? <LinkedFrom links={links} view={view} /> : null}
      {links.mentionCount ? <Mentions links={links} view={view} /> : null}
    </section>
  );
}
