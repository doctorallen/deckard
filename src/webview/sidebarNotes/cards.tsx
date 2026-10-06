/**
 * The cards Related Notes lists: a ranked result, with its score, where it
 * is written, its excerpt, and why it is listed; a graph node's
 * connections; the entries worded like a note with no tags; and Home's
 * widgets to add, while Home is in front.
 */
import type { ComponentChildren } from 'preact';

import type { NotesGraphNode, SidebarGraphContext } from '../../ui/protocol/notesGraph';
import type { RankedNote, SidebarNotesSnapshot, SuggestedTag } from '../../ui/protocol/sidebarNotes';
import type { TagReference, TagTitleDisplayMode } from '../../ui/protocol/shared';
import { LinkIcon } from '../shared/strokeIcons';
import { TitleWithTags } from '../shared/tagButton';
import { TagLabel } from '../shared/tagLabel';
import { formatSourceLocation, HeadingPathSteps, trimHeadingPath } from '../shared/taskRow';
import { explainRelevance, RelevanceScore } from './weights';
import { describeEntryDetails, readEntryDetails } from '../shared/entryDetails';

/** What a card shows besides its entry: how many lines of excerpt, and how titles draw their tags. */
export interface CardDisplay {
  /** 0, 1, or 2 lines of each excerpt. */
  readonly previewLines: number;
  readonly titleDisplay: TagTitleDisplayMode;
}

/** The parts a card is made of, which every kind of card lays out the same way. */
interface NoteCardProps {
  /** Classes after `note `, which the template wrote with its space either way. */
  readonly className: string;
  /** The data attributes that say what the card opens. */
  readonly attributes: Readonly<Record<string, string | number>>;
  readonly title: ComponentChildren;
  readonly trailing: ComponentChildren;
  readonly source: ComponentChildren;
  readonly body: ComponentChildren;
}

/** The shell a ranked result and a graph node's connection share. */
function NoteCard(props: NoteCardProps) {
  return (
    <article class={`note ${props.className}`} tabIndex={0} data-tip-around="" data-tip="Open this entry. Cmd/Ctrl-click to open it beside the note you are reading." {...props.attributes}>
      <div class="note-header">
        <h2 class="note-title">{props.title}</h2>
        {props.trailing}
      </div>
      {props.source}
      {props.body}
    </article>
  );
}

/** A tag under a result, which opens the tag rather than the result. */
function MatchedTag({ tag }: { readonly tag: TagReference }) {
  return (
    <button class="matched-tag" data-action="open-tag" data-tag-key={tag.key} aria-label={`Open ${tag.label} overview`}>
      <TagLabel label={tag.label} />
    </button>
  );
}

/**
 * The tags drawn as chips on a result's card: the matched tags under the
 * title when tags are shown apart from it and there are any, or else the
 * title's own.
 */
function chipsOf(note: RankedNote, titleDisplay: TagTitleDisplayMode): readonly TagReference[] {
  if (titleDisplay === 'separate' && note.matchedTags.length) {
    return note.matchedTags || [];
  }
  return note.titleTags || [];
}

/** The searched-for words a result shares with the note, which its excerpt marks: five at most. */
function sharedTerms(note: RankedNote): string[] {
  const terms = note.relevanceEvidence ? note.relevanceEvidence.lexicalTerms || [] : [];
  return terms.slice(0, 5).map((term) => term.term);
}

/** What a result's card opens, and the words its excerpt marks, when it shares any. */
function cardAttributes(note: RankedNote): Record<string, string | number> {
  const terms = sharedTerms(note);
  const attributes: Record<string, string | number> = { 'data-file-path': note.filePath, 'data-line': note.sourceLine };
  if (terms.length) {
    attributes['data-terms'] = terms.join(' ');
  }
  return attributes;
}

/**
 * Writing a link to a result is the reason to have found it, and the
 * sidebar sits beside the note being written in. The button stays out of
 * the way until the card is under the pointer.
 */
function InsertLink({ title }: { readonly title: string }) {
  return (
    <button type="button" class="insert-link" data-action="insert-link" aria-label={`Insert a link to ${title} at the cursor`} data-tip="Write a [[link]] to this entry at the cursor">
      <LinkIcon />
    </button>
  );
}

/** A result's details line, carried down under it as a search card's is: those ticked in Card details. */
function RankedNoteDetails({ note, fileName }: { readonly note: RankedNote; readonly fileName: string }) {
  const line = describeEntryDetails({ location: formatSourceLocation(fileName, note.sourceLine), createdAt: note.createdAt, updatedAt: note.updatedAt });
  return line ? <div class="source">{line}</div> : null;
}

/** One ranked result: its title, score, where it is, excerpt, and why. */
export function RankedNoteCard({ note, display }: { readonly note: RankedNote; readonly display: CardDisplay }) {
  const title = note.title || note.fileName || note.filePath;
  const fileName = note.fileName || note.filePath;
  const reasons = explainRelevance(note, chipsOf(note, display.titleDisplay).map((tag) => tag.label));
  const steps = trimHeadingPath(note.headingPath, fileName, note.title);
  return (
    <NoteCard
      className=""
      attributes={cardAttributes(note)}
      title={display.titleDisplay === 'inline' ? <TitleWithTags title={title} tags={note.titleTags || []} /> : title}
      trailing={<div class="note-actions"><InsertLink title={title} /><RelevanceScore note={note} reasons={reasons} /></div>}
      source={<RankedNoteDetails note={note} fileName={fileName} />}
      body={[
        steps.length && readEntryDetails().has('fileAndLine') ? <div class="source heading-path"><HeadingPathSteps steps={steps} /></div> : null,
        note.excerpt && display.previewLines > 0 ? <p class="note-excerpt">{note.excerpt}</p> : null,
        reasons.length ? <div class="relevance-reason">{reasons[0]}</div> : null,
        <div class="tag-list" aria-label="Matching tags">
          {display.titleDisplay === 'separate' ? note.matchedTags.map((tag) => <MatchedTag tag={tag} />) : null}
        </div>,
      ]}
    />
  );
}

/**
 * Results as cards, each keyed by the line it opens, so a result keeps its
 * card when the list is ranked again, and the focus stays on the result it
 * was on rather than on whatever moved into its place. Two results on one
 * line are told apart by their turn.
 */
export function RankedNoteCards({ notes, display }: { readonly notes: readonly RankedNote[]; readonly display: CardDisplay }) {
  const seen = new Map<string, number>();
  return (
    <>
      {notes.map((note) => {
        const place = `${note.filePath}:${note.sourceLine}`;
        const turn = seen.get(place) ?? 0;
        seen.set(place, turn + 1);
        return <RankedNoteCard key={turn ? `${place}#${turn}` : place} note={note} display={display} />;
      })}
    </>
  );
}

/** A graph node's name: a tag as its pill, anything else as its title. */
function NodeTitle({ node }: { readonly node: NotesGraphNode }) {
  return node.kind === 'tag'
    ? <span class="inline-tag graph-tag-pill"><TagLabel label={node.title} /></span>
    : <>{node.title}</>;
}

/**
 * The node chosen on the graph, which opens it, over what it connects to.
 */
export function SelectedGraphNode({ node }: { readonly node: NotesGraphNode }) {
  return (
    <button type="button" class="active-file graph-selected-node" data-action="open-selected-graph-node" data-node-id={node.id} aria-label={`Open selected ${node.kind}: ${node.title}`}>
      <span class="active-label">Selected graph node · open</span>
      <span class="active-name"><NodeTitle node={node} /></span>
    </button>
  );
}

/** What a graph node connects to, each a card that selects it on the graph. */
export function GraphConnections({ graph }: { readonly graph: SidebarGraphContext }) {
  if (!graph.selectedNode) {
    return <div class="empty">Select a graph node to inspect its connections.</div>;
  }
  if (!graph.connections.length) {
    return <div class="empty">This graph node has no direct connections.</div>;
  }
  return (
    <div class="note-list">
      {graph.connections.map((connection) => {
        const node = connection.node;
        const source = node.filePath
          ? formatSourceLocation(node.filePath.split('/').pop() || node.filePath, node.line as number)
          : 'Tag node';
        return (
          <NoteCard
            className="graph-node"
            attributes={{ 'data-node-id': node.id }}
            title={<NodeTitle node={node} />}
            // kind-note, not note: a bare note or task class is a card's,
            // and gave the badge a card's edge and hover.
            trailing={<span class={`graph-kind kind-${node.kind}`}>{node.kind}</span>}
            source={<div class="source">{source}</div>}
            body={<div class="source">{connection.types.map((type) => type.replaceAll('-', ' ')).join(' · ')}</div>}
          />
        );
      })}
    </div>
  );
}

/** A tag the similar entries use, which opens, and which Add writes on the note. */
function SuggestedTagRow({ tag }: { readonly tag: SuggestedTag }) {
  return (
    <div class="suggested-tag">
      <button type="button" class="tag-open active-tag-open" data-action="open-tag" data-tag-key={tag.key} data-tip={`On ${tag.entryCount} of the similar entries below. Add writes it on the heading or line where the cursor is.`}>
        <TagLabel label={tag.label} />
        <span class="refine-count">{tag.entryCount}</span>
      </button>
      <button type="button" class="suggested-tag-add" data-action="add-suggested-tag" data-suggested-tag={tag.key} aria-label={`Add ${tag.label} to this note`} data-tip={`Write ${tag.label} on the heading or line where the cursor is`}>Add</button>
    </div>
  );
}

/**
 * For a note with no tags: the tags entries worded like it use, first,
 * since tagging it is the way out of guessing, then those entries, each
 * marked weak and kept apart from the related notes. Nothing when there
 * are neither.
 */
export function Similar({ similar, display }: { readonly similar: SidebarNotesSnapshot['similar']; readonly display: CardDisplay }) {
  if (!similar || (!similar.notes.length && !similar.tags.length)) {
    return null;
  }
  return (
    <>
      {similar.tags.length
        ? (
          <section class="suggested-tags" aria-label="Tags used by similar notes">
            <span class="section-label">Tags used by similar notes</span>
            {similar.tags.map((tag) => <SuggestedTagRow tag={tag} />)}
          </section>
        )
        : null}
      {similar.notes.length
        ? (
          <section class="similar-wording" aria-label="Similar wording (no tags yet)">
            <span class="section-label">Similar wording (no tags yet)</span>
            <p class="similar-hint">These share words with this note, not tags or links.</p>
            <div class="note-list"><RankedNoteCards notes={similar.notes} display={display} /></div>
          </section>
        )
        : null}
    </>
  );
}

/** Why an untagged note's list is empty, or the similar entries in its place. */
export function NoTags({ similar, display }: { readonly similar: SidebarNotesSnapshot['similar']; readonly display: CardDisplay }) {
  if (!similar) {
    return <div class="empty">This note has no tags yet.</div>;
  }
  if (!similar.notes.length && !similar.tags.length) {
    return <div class="empty">This note has no tags yet, and no other entry shares enough of its wording to suggest any.</div>;
  }
  return <Similar similar={similar} display={display} />;
}

/** Home's widgets to add, each one a click, and Reset. */
export function CustomizeHome({ widgets }: { readonly widgets: NonNullable<SidebarNotesSnapshot['homeWidgets']> }) {
  return (
    <>
      <span class="section-label">Add a widget</span>
      {widgets.length
        ? (
          <ul class="home-widget-choices">
            {widgets.map((widget) => (
              <li>
                <button type="button" class="home-widget-choice" data-action="home-add-widget" data-value={widget.value} data-tip={widget.description || undefined}>
                  <span class="home-widget-choice-label">{`+ ${widget.label}`}</span>
                  {widget.description ? <span class="home-widget-choice-detail">{widget.description}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )
        : <div class="empty">Every widget is on Home.</div>}
      <button type="button" class="home-reset-widgets" data-action="home-reset-widgets" data-tip="Put back the widgets Home started with">Reset widgets…</button>
    </>
  );
}
