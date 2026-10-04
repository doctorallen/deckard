import MarkdownIt = require('markdown-it');

import { ATTACHMENT } from './noteNames';

/**
 * markdown-it, configured as the pages have always read note Markdown, for
 * its token stream alone: `inline.ts` and `blockExcerpt.ts` map the tokens
 * into Deckard's token tree. Nothing here renders, so no HTML is ever made,
 * and the tree a page draws as elements and text nodes is the boundary
 * (decision 0015).
 *
 * The options are the ones the pages' HTML was rendered with until Phase 6
 * retired that HTML: no HTML, so `<b>` in a note is text; no linkify, so a
 * bare URL is text; and every line break a break. One rule is added:
 * `[[wiki links]]`, which markdown-it does not know, read before links so
 * their brackets are never a link's label. A parse that asks for them also
 * reads embeds as blocks of their own, as the preview does.
 */

/** One markdown-it token, as the mappers read it. */
export type MarkdownToken = MarkdownIt.Token;

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
});
markdown.inline.ruler.before('link', 'wiki_link', wikiLinkRule);
markdown.block.ruler.before('paragraph', 'note_embed', noteEmbedRule, { alt: ['paragraph', 'blockquote', 'list'] });

/** What a `wiki_link` token's `meta` holds. */
export interface WikiLinkMeta {
  /** The note it names: the text before any `|`, trimmed. */
  target: string;
  /** Whether it is written `![[…]]`. */
  embed: boolean;
}

/**
 * A `[[wiki link]]` or `![[embed]]` closed on the same line, as a
 * `wiki_link` token whose content is its literal text: Markdown inside it
 * stays as written. A silent pass, which markdown-it makes while it looks
 * for where a link's label ends, does not read one, as the hand-written
 * tokenizer before this did not.
 */
function wikiLinkRule(state: MarkdownIt.StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  const embed = src[pos] === '!';
  const open = embed ? pos + 1 : pos;
  if (silent || (state.env as ParseEnv).withoutWikiLinks || !src.startsWith('[[', open)) {
    return false;
  }
  const close = src.indexOf(']]', open + 2);
  if (close < 0 || close + 2 > state.posMax || src.slice(open + 2, close).includes('\n')) {
    return false;
  }
  const token = state.push('wiki_link', '', 0);
  token.content = src.slice(pos, close + 2);
  const meta: WikiLinkMeta = { target: src.slice(open + 2, close).split('|')[0].trim(), embed };
  token.meta = meta;
  state.pos = close + 2;
  return true;
}

/** What a `note_embed` token's `meta` holds. */
export interface NoteEmbedMeta {
  /** What the embed names, as written. */
  target: string;
}

/** An embed alone on its line, once the line's indent and its list or quote marker are behind it. */
const EMBED_BLOCK = /^!\[\[([^\]]+)\]\][ \t]*$/;

/**
 * A `![[…]]` alone on its line, in a parse that asks for embeds, as a
 * `note_embed` token: the preview's `deckard_embed` rule, which draws such a
 * line as what it names, at the top level, in a list item, or in a quote, and
 * ends a paragraph it interrupts. An attachment's is left a line of text.
 */
function noteEmbedRule(state: MarkdownIt.StateBlock, startLine: number, _endLine: number, silent: boolean): boolean {
  if (!(state.env as ParseEnv).withEmbeds || state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const match = EMBED_BLOCK.exec(state.src.slice(start, state.eMarks[startLine]));
  if (!match || ATTACHMENT.test(match[1].split(/[#|]/)[0].trim())) {
    return false;
  }
  if (silent) {
    return true;
  }
  const token = state.push('note_embed', '', 0);
  token.map = [startLine, startLine + 1];
  const meta: NoteEmbedMeta = { target: match[1] };
  token.meta = meta;
  state.line = startLine + 1;
  return true;
}

/** What a parse is told: whether to leave `[[wiki links]]` to markdown-it's own rules, and whether to read embeds. */
interface ParseEnv {
  withoutWikiLinks?: boolean;
  withEmbeds?: boolean;
}

/**
 * A line of inline Markdown's tokens, as `renderInline` read them. Without
 * wiki links, `[[` is read as markdown-it alone reads it: brackets, with
 * the Markdown between them read as Markdown.
 */
export function parseInlineMarkdown(source: string, { withoutWikiLinks = false } = {}): MarkdownToken[] {
  const env: ParseEnv = withoutWikiLinks ? { withoutWikiLinks } : {};
  return markdown.parseInline(source, env)[0]?.children ?? [];
}

/**
 * A Markdown text's block tokens, as `render` read them, link reference
 * definitions applied; with `embeds`, each embed alone on its line a
 * `note_embed` token.
 */
export function parseBlockMarkdown(source: string, { embeds = false } = {}): MarkdownToken[] {
  const env: ParseEnv = embeds ? { withEmbeds: true } : {};
  return markdown.parse(source, env);
}
