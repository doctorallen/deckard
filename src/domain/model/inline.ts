/**
 * Inline Markdown as tokens: the words of a title or a paragraph with their
 * emphasis, code, links, and wiki links, as data a page draws with elements
 * and text nodes. `domain/markdown/inline.ts` reads Markdown into them; the
 * protocol carries them to the pages. Nothing here is HTML: a link token
 * only ever carries an http, https, or mailto URL.
 */

/** Words, with backslash escapes and character references already decoded. */
export interface TextToken {
  kind: 'text';
  text: string;
}

/** A code span's contents, verbatim but for line breaks read as spaces. */
export interface CodeToken {
  kind: 'code';
  text: string;
}

/**
 * A line break. Every line break inside a paragraph is one, not only a hard
 * break, because Deckard renders with `breaks: true`: a note's lines stay
 * lines on its card.
 */
export interface BreakToken {
  kind: 'break';
}

/** Strong emphasis, emphasis, or strikethrough (`~~`) around other tokens. */
export interface EmphasisToken {
  kind: 'strong' | 'em' | 'del';
  children: InlineToken[];
}

/**
 * A Markdown link to the web or to mail. `url` is percent-encoded and always
 * starts with `http:`, `https:`, or `mailto:`; a link to anything else is
 * read as its words alone, so no token can carry a script or a file path.
 */
export interface LinkToken {
  kind: 'link';
  url: string;
  title?: string;
  children: InlineToken[];
}

/**
 * A `[[wiki link]]` or a `![[embed]]`. It is drawn as `text`, exactly as
 * written, brackets and all, as the pages have always shown one; `target` is
 * the note it names, kept for when a page makes it a control.
 */
export interface WikiLinkToken {
  kind: 'wikiLink';
  text: string;
  target: string;
  embed: boolean;
}

/** One piece of inline Markdown. */
export type InlineToken = TextToken | CodeToken | BreakToken | EmphasisToken | LinkToken | WikiLinkToken;
