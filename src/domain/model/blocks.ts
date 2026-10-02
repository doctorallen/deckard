/**
 * A note excerpt as a block token tree, the way a card shows it: paragraphs,
 * headings, lists, code, quotes, rules, and tables, each holding inline
 * tokens. `domain/markdown/blockExcerpt.ts` reads Markdown into them; the
 * protocol carries them to the pages. Like the inline tokens, they are data
 * and never HTML.
 */
import type { InlineToken } from './inline';

/** A paragraph. Its line breaks are break tokens. */
export interface ParagraphBlock {
  kind: 'paragraph';
  children: InlineToken[];
}

/** An ATX (`## Words`) or setext (words underlined by `===` or `---`) heading. */
export interface HeadingBlock {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineToken[];
}

/**
 * A bulleted or numbered list. In a tight list, one with no blank line
 * between its items or inside them, an item's paragraphs are drawn as bare
 * text, without the space a paragraph puts around itself.
 */
export interface ListBlock {
  kind: 'list';
  ordered: boolean;
  /** The first item's number, when the list is numbered and does not start at 1. */
  start?: number;
  tight: boolean;
  /** Each item's blocks. */
  items: BlockToken[][];
}

/** A fenced or indented code block's text, verbatim, line breaks and all. */
export interface CodeBlock {
  kind: 'code';
  text: string;
}

/** A block quote and the blocks inside it. */
export interface QuoteBlock {
  kind: 'quote';
  children: BlockToken[];
}

/** A thematic break: `---`, `***`, or `___` on a line of its own. */
export interface RuleBlock {
  kind: 'rule';
}

/**
 * A table: its rows, header row first, each a list of cells' inline tokens.
 * The pages never drew a table as one, since the sanitizer removed the table
 * elements and left the cells' words, so a page shows the cells as text.
 */
export interface TableBlock {
  kind: 'table';
  rows: InlineToken[][][];
}

/** One block of an excerpt. */
export type BlockToken = ParagraphBlock | HeadingBlock | ListBlock | CodeBlock | QuoteBlock | RuleBlock | TableBlock;
