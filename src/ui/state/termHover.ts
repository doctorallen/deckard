/**
 * What a term's hover says (docs/implementation/42-terms.md): the term,
 * its definition, how many entries use it, where it was defined, and the
 * links it offers. Kept apart from VS Code, so a test reads it as text.
 *
 * ```
 * NDF · non-deliverable forward · 4 entries
 * Defined Tue, Mar 3 in FX recon kickoff: "Book the NDF (non-deliverable forward) trades."
 * Open definition · Find uses · Make a term note
 * ```
 */
import { formatIsoDate } from '../../domain/markdown/calendar';
import { formatShortDay } from '../../domain/markdown/dates';
import { type DateFormats, DEFAULT_DATE_FORMATS } from '../../domain/markdown/dateFormat';
import type { TermEntry } from '../../domain/terms/terms';
import { getFileName } from '../../shared/paths';
import { escapeMarkdown, pluralize } from '../../shared/text';

/** The command that opens New Note from Type… for Term, the term and its words filled. */
export const MAKE_TERM_NOTE_COMMAND = 'deckard.makeTermNote';

/** How long a quoted line may be before it is cut. */
const QUOTE_LENGTH = 80;

/** A link a term's hover offers: its words, the command, and the command's arguments. */
export interface TermHoverLink {
  title: string;
  command: string;
  arguments: unknown[];
}

/** A term's hover, as Markdown lines and the links under them. */
export interface TermHover {
  /** `**NDF** · *non-deliverable forward* · *4 entries*`. */
  title: string;
  /** Where it was defined: *Defined Tue, Mar 3 in FX recon kickoff: "…"*, or *From NDF.md*. */
  source: string;
  links: TermHoverLink[];
}

/** The search that finds a term written as a word. */
export function termSearch(term: string): string {
  return `text = ${/^[A-Z0-9]+$/.test(term) ? term : `"${term}"`}`;
}

/** A line cut to its first 80 characters. */
function quote(text: string): string {
  return text.length > QUOTE_LENGTH ? `${text.slice(0, QUOTE_LENGTH - 1)}…` : text;
}

/**
 * The hover of a defined term, its day in the reader's short format; none
 * for a term with no definition. Make a term note is offered only for an
 * inline definition, which it carries into the note.
 */
export function describeTermHover(entry: TermEntry, now: number, formats: DateFormats = DEFAULT_DATE_FORMATS): TermHover | undefined {
  const { definition } = entry;
  if (!definition) {
    return undefined;
  }
  const title = [
    `**${escapeMarkdown(entry.term)}**`,
    `*${escapeMarkdown(definition.text)}*`,
    `*${pluralize(entry.count, 'entry', 'entries')}*`,
  ].join(' · ');
  const links: TermHoverLink[] = [
    { title: 'Open definition', command: 'deckard.openNote', arguments: [definition.filePath, definition.line] },
    { title: 'Find uses', command: 'deckard.search', arguments: [termSearch(entry.term)] },
  ];
  if (definition.source === 'note') {
    return { title, source: `*From ${escapeMarkdown(getFileName(definition.filePath))}*`, links };
  }
  const day = definition.date > 0 ? ` ${formatShortDay(formatIsoDate(definition.date), now, formats)}` : '';
  const where = definition.heading ?? getFileName(definition.filePath).replace(/\.md$/i, '');
  const said = definition.quote ? `: "${escapeMarkdown(quote(definition.quote))}"` : '';
  return {
    title,
    source: `*Defined${escapeMarkdown(day)} in ${escapeMarkdown(where)}${said}*`,
    links: [...links, { title: 'Make a term note', command: MAKE_TERM_NOTE_COMMAND, arguments: [entry.term, definition.text] }],
  };
}
