import MarkdownIt = require('markdown-it');

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
 * their brackets are never a link's label.
 */

/** One markdown-it token, as the mappers read it. */
export type MarkdownToken = MarkdownIt.Token;

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
});
markdown.inline.ruler.before('link', 'wiki_link', wikiLinkRule);

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

/** What a parse is told: whether to leave `[[wiki links]]` to markdown-it's own rules. */
interface ParseEnv {
  withoutWikiLinks?: boolean;
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

/** A Markdown text's block tokens, as `render` read them, link reference definitions applied. */
export function parseBlockMarkdown(source: string): MarkdownToken[] {
  return markdown.parse(source, {});
}
