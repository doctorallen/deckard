import { InlineToken, mapInlineTokens } from './inline';
import { MarkdownToken, parseBlockMarkdown } from './markdownTokens';

/**
 * A note excerpt as a block token tree, the way a card shows it: paragraphs,
 * headings, lists, code, quotes, rules, and tables, each holding inline
 * tokens. Like the inline tokens, it is data and never HTML.
 *
 * markdown-it reads the blocks, configured as the pages have always read
 * them (`markdownTokens.ts`), so a card breaks into the blocks it did when
 * markdown-it drew it, setext headings, lazy quote lines, loose lists, and
 * link reference definitions included; this maps its tokens into the tree.
 * HTML blocks never arise, since `html: false` reads them as paragraphs.
 */

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

/**
 * Reads Markdown, a card's excerpt, into blocks as markdown-it's `render`
 * read it.
 */
export function buildBlockExcerpt(markdown: string): BlockToken[] {
  return readBlocks({ tokens: parseBlockMarkdown(markdown), index: 0 }, -1);
}

/** markdown-it's flat list of block tokens, and how far the mapper has read. */
interface Cursor {
  readonly tokens: readonly MarkdownToken[];
  index: number;
}

/**
 * Reads blocks up to the token that closes the container opened at `level`,
 * or to the end, and moves past it. A container's opening and closing
 * tokens share a level, and the blocks inside sit one deeper.
 */
function readBlocks(cursor: Cursor, level: number): BlockToken[] {
  const blocks: BlockToken[] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.nesting === -1 && token.level === level) {
      break;
    }
    const block = readBlock(token, cursor);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

/** The block a token starts, read through its close; undefined for a token no block starts at. */
function readBlock(token: MarkdownToken, cursor: Cursor): BlockToken | undefined {
  switch (token.type) {
    case 'paragraph_open':
      return { kind: 'paragraph', children: readInlineContent(cursor) };
    case 'heading_open':
      return { kind: 'heading', level: Number(token.tag.slice(1)) as HeadingBlock['level'], children: readInlineContent(cursor) };
    case 'bullet_list_open':
    case 'ordered_list_open':
      return readList(token, cursor);
    case 'blockquote_open':
      return { kind: 'quote', children: readBlocks(cursor, token.level) };
    case 'code_block':
    case 'fence':
      return { kind: 'code', text: token.content };
    case 'hr':
      return { kind: 'rule' };
    case 'table_open':
      return { kind: 'table', rows: readTableRows(cursor, token.level) };
    default:
      return undefined;
  }
}

/** A paragraph's or a heading's inline tokens, moving past its close. */
function readInlineContent(cursor: Cursor): InlineToken[] {
  const inline = cursor.tokens[cursor.index];
  cursor.index += 2;
  return mapInlineTokens(inline.children ?? []);
}

/**
 * A list, each item its blocks. markdown-it keeps whether a list is tight
 * only by hiding its items' paragraphs, so that is where it is read; a list
 * whose items hold no paragraph shows the same either way and counts as
 * tight.
 */
function readList(open: MarkdownToken, cursor: Cursor): ListBlock {
  const start = Number(open.attrGet('start') ?? 1);
  const list: ListBlock = {
    kind: 'list',
    ordered: open.type === 'ordered_list_open',
    ...(start === 1 ? {} : { start }),
    tight: isTight(cursor, open.level),
    items: [],
  };
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.nesting === -1 && token.level === open.level) {
      break;
    }
    if (token.type === 'list_item_open') {
      list.items.push(readBlocks(cursor, token.level));
    }
  }
  return list;
}

/** Whether no paragraph directly in the items of the list opened at `level` is shown as one. */
function isTight(cursor: Cursor, level: number): boolean {
  for (let index = cursor.index; index < cursor.tokens.length; index += 1) {
    const token = cursor.tokens[index];
    if (token.nesting === -1 && token.level === level) {
      return true;
    }
    if (token.type === 'paragraph_open' && token.level === level + 2 && !token.hidden) {
      return false;
    }
  }
  return true;
}

/** A table's rows, header first, each its cells' inline tokens, moving past its close. */
function readTableRows(cursor: Cursor, level: number): InlineToken[][][] {
  const rows: InlineToken[][][] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.nesting === -1 && token.level === level) {
      break;
    }
    if (token.type === 'tr_open') {
      rows.push([]);
    } else if (token.type === 'inline') {
      rows[rows.length - 1].push(mapInlineTokens(token.children ?? []));
    }
  }
  return rows;
}
