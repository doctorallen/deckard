/**
 * A note as a search's results draw it: a card with its title, its tags,
 * where it is written, and its body, as Markdown source or drawn from its
 * block tokens.
 */
import type { BlockToken } from '../../ui/protocol/inline';
import type { SearchPageSnapshot } from '../../ui/protocol/searchPage';
import type { TagOverviewCard, TagTitleDisplayMode } from '../../ui/protocol/shared';
import { BlockExcerpt } from './blockExcerpt';
import { TagButton, TitleWithTags } from './tagButton';
import { formatSourceLocation, HeadingPathSteps, ParkedLabel, trimHeadingPath } from './taskRow';

/** How a page draws its cards: the Format, Preview, and tag rows of its gear. */
export interface CardDisplay {
  /** `html` draws a body from its tokens; `markdown` shows its source. */
  readonly renderMode: SearchPageSnapshot['renderMode'];
  /** How much of each body: none, three lines with Show all, or the whole. */
  readonly preview: SearchPageSnapshot['preview'] | undefined;
  /** `inline` draws a title's tags as controls where they are written; `separate` lists them after it. */
  readonly titleDisplay: TagTitleDisplayMode;
}

/**
 * Text as the template's HTML parser left it in a `<pre>`: a carriage
 * return read as a line's end, and the line's end right after the opening
 * tag dropped.
 */
function asParsedPreText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n');
  return lines.startsWith('\n') ? lines.slice(1) : lines;
}

/**
 * A note's body as the Format row draws it: drawn from its tokens, or its
 * Markdown source as written. Nothing for a body with no text. Keyed by its
 * source, so a body that changes is drawn afresh rather than patched: a
 * link reused without a title would keep an empty one.
 */
export function NoteBody({ rawContent, blocks, renderMode }: {
  readonly rawContent: string;
  readonly blocks: readonly BlockToken[];
  readonly renderMode: CardDisplay['renderMode'];
}) {
  if (!rawContent) {
    return null;
  }
  return renderMode === 'html'
    ? <div key={`rendered:${rawContent}`} class="rendered"><BlockExcerpt blocks={blocks} /></div>
    : <pre key={`markdown:${rawContent}`} class="markdown">{asParsedPreText(rawContent)}</pre>;
}

/** Says a card's body starts further down its entry, where the searched words are. */
function SnippetLead() {
  return (
    <div key="lead" class="card-snippet-lead">
      <span aria-hidden="true">…</span>
      <span class="visually-hidden">From further down the entry:</span>
    </div>
  );
}

/** How a search draws one note it found. */
export interface SearchCardProps {
  readonly card: TagOverviewCard;
  readonly position: number;
  readonly display: CardDisplay;
  /** Whether the reader opened this card with Show all. */
  readonly opened: boolean;
}

/**
 * A card's body as the Preview row asks: nothing, three lines with Show
 * all, or the whole of it. On a search of words, the three lines are the
 * paragraph the first word is in, when it sits further down.
 */
function CardBody({ card, position, display, opened }: SearchCardProps) {
  const preview = display.preview || 'lines';
  if (preview === 'none') {
    return null;
  }
  const clamped = preview === 'lines' && !opened;
  const snippet = clamped ? card.snippet : undefined;
  const body = snippet
    ? <NoteBody rawContent={snippet.rawContent} blocks={snippet.bodyTokens} renderMode={display.renderMode} />
    : <NoteBody rawContent={card.rawContent} blocks={card.bodyTokens} renderMode={display.renderMode} />;
  if (!snippet && !card.rawContent) {
    return null;
  }
  const id = `card-body-${position}`;
  const title = String(card.heading || '').trim();
  return (
    <>
      <div key="body" class={clamped ? 'card-body is-clamped' : 'card-body'} id={id}>
        {snippet ? <SnippetLead /> : null}
        {body}
      </div>
      {preview === 'lines' && card.long
        ? (
          <button
            key="more"
            type="button"
            class="card-more"
            data-action="toggle-card-body"
            data-card-id={card.id}
            aria-expanded={opened}
            aria-controls={id}
            aria-label={`${opened ? 'Show less of ' : 'Show all of '}${title}`}
          >
            {opened ? 'Show less' : 'Show all'}
          </button>
        )
        : null}
    </>
  );
}

/** The words a reader's typing is matched against before the host answers: title, file, body, and tags. */
function searchTextOf(card: TagOverviewCard, fileName: string): string {
  return [card.heading, fileName, card.rawContent, card.tags.map((tag) => tag.label).join(' ')].join(' ').toLowerCase();
}

/** A card's title: its heading with its tags as controls, or its heading alone with its tags after it. */
function CardTitle({ card, titleDisplay }: { readonly card: TagOverviewCard; readonly titleDisplay: TagTitleDisplayMode }) {
  const separate = titleDisplay === 'separate';
  return (
    <h2 class="card-title">
      {titleDisplay === 'inline' ? <TitleWithTags title={card.heading} tags={card.titleTags} /> : card.heading}
      {separate && card.tags.length
        ? <span key="tags" class="tag-list" aria-label="Section tags">{card.tags.map((tag) => <TagButton tag={tag} />)}</span>
        : null}
      {card.parked ? <ParkedLabel key="parked" /> : null}
    </h2>
  );
}

/**
 * One note a search found: its title and tags, its file and line with the
 * headings above it, as the Related Notes sidebar shows them, and its body.
 * It carries what opening it, pinning it, and parking it need.
 */
export function SearchCard({ card, position, display, opened }: SearchCardProps) {
  const fileName = card.filePath.split('/').pop() || card.filePath;
  const steps = trimHeadingPath(card.headingPath, fileName, card.heading);
  return (
    <article
      class="card"
      tabIndex={0}
      data-search-entry="notes"
      data-search-text={searchTextOf(card, fileName)}
      data-file-path={card.filePath}
      data-line={card.startLine}
      data-pinned={card.pinned ? 'true' : 'false'}
      data-parked={card.parked ? 'true' : 'false'}
    >
      <div class="card-header">
        <CardTitle card={card} titleDisplay={display.titleDisplay} />
        <div class="source">
          {`${formatSourceLocation(fileName, card.startLine)}${card.via === 'hubLink' ? ' ' : ''}`}
          {card.via === 'hubLink' ? <span class="card-via">Links the hub note</span> : null}
        </div>
        {steps.length ? <div key="path" class="source heading-path"><HeadingPathSteps steps={steps} /></div> : null}
      </div>
      <CardBody card={card} position={position} display={display} opened={opened} />
    </article>
  );
}
