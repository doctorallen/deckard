import { MarkdownToken, parseInlineMarkdown, WikiLinkMeta } from './markdownTokens';
import type { EmphasisToken, InlineToken, LinkToken } from '../model/inline';

/**
 * Inline Markdown as tokens: the words of a title or a paragraph with their
 * emphasis, code, links, and wiki links, as data a page draws with elements
 * and text nodes. Nothing here is HTML and nothing is parsed as HTML, so
 * there is nothing to sanitize: `<b>` in a note is three characters of text,
 * and a link token only ever carries an http, https, or mailto URL.
 *
 * markdown-it reads the Markdown, configured as the pages have always read
 * it (`markdownTokens.ts`), and this maps its tokens into the tree. Where
 * the tree parts from what markdown-it and the sanitizer drew, it is on
 * purpose and named where it happens: wiki links, links to anything but the
 * web and mail, strikethrough, and images. The tokens' types are the domain
 * model's (`model/inline.ts`), which the protocol carries to the pages;
 * they are exported here too.
 */

export type {
  BreakToken,
  CodeToken,
  EmphasisToken,
  InlineToken,
  LinkToken,
  TextToken,
  WikiLinkToken,
} from '../model/inline';

/**
 * Reads a line of inline Markdown, such as a task title, into tokens, as
 * markdown-it's `renderInline` read it: no blocks, and line breaks as breaks.
 */
export function tokenizeInline(source: string): InlineToken[] {
  return mapInlineTokens(parseInlineMarkdown(source));
}

/**
 * Reads a line of inline Markdown as markdown-it alone reads it, with no
 * wiki-link rule: `[[a *b*]]` is brackets around an emphasis, and
 * `[[a]](https://…)` a link. The Markdown preview's query blocks write
 * titles from these, since the preview's HTML has always been
 * markdown-it's reading; the pages draw `tokenizeInline`'s.
 */
export function tokenizeInlineWithoutWikiLinks(source: string): InlineToken[] {
  return mapInlineTokens(parseInlineMarkdown(source, { withoutWikiLinks: true }));
}

/** The schemes a link token may carry: the web and mail, nothing that runs or reads a file. */
const SAFE_SCHEME = /^(?:https?|mailto):/i;

/** The emphasis each of markdown-it's opening tokens stands for. */
const EMPHASIS: Readonly<Partial<Record<string, EmphasisToken['kind']>>> = {
  strong_open: 'strong',
  em_open: 'em',
  // markdown-it writes `~~` as `<s>`, which the sanitizer removed; the tree
  // draws it as strikethrough, as Q8 of 20-webviews.md decided.
  s_open: 'del',
};

/**
 * Maps markdown-it's inline tokens, a flat list where each `_open` has its
 * `_close`, into the tree. The words of a link the tree will not carry go
 * into the list the link would have gone into, so a link to a note is its
 * words alone.
 */
export function mapInlineTokens(tokens: readonly MarkdownToken[]): InlineToken[] {
  const root: InlineToken[] = [];
  const parents: InlineToken[][] = [];
  let current = root;
  for (const token of tokens) {
    if (token.nesting === -1) {
      current = parents.pop() ?? root;
      continue;
    }
    if (token.nesting === 0) {
      appendToken(current, mapLeaf(token));
      continue;
    }
    parents.push(current);
    const node = mapOpening(token);
    if (node) {
      current.push(node);
      current = node.children;
    }
  }
  return root;
}

/**
 * The container an opening token starts: emphasis, or a link to the web or
 * to mail, read from markdown-it's normalized href. Undefined for a link to
 * anything else (a relative path, `ftp:`, `obsidian:`), where markdown-it
 * drew an anchor whose href the sanitizer then removed or a page could not
 * follow; its words stay where they are.
 */
function mapOpening(token: MarkdownToken): EmphasisToken | LinkToken | undefined {
  const emphasis = EMPHASIS[token.type];
  if (emphasis) {
    return { kind: emphasis, children: [] };
  }
  const url = token.attrGet('href') ?? '';
  if (token.type !== 'link_open' || !SAFE_SCHEME.test(url)) {
    return undefined;
  }
  const title = token.attrGet('title');
  return { kind: 'link', url, ...(title ? { title } : {}), children: [] };
}

/**
 * The token a self-contained markdown-it token becomes, or undefined for
 * one that shows nothing: an image, since markdown-it drew an `<img>` and
 * the sanitizer removed it, alt text and all.
 */
function mapLeaf(token: MarkdownToken): InlineToken | undefined {
  switch (token.type) {
    case 'text':
    case 'text_special':
      return { kind: 'text', text: token.content };
    case 'softbreak':
    case 'hardbreak':
      return { kind: 'break' };
    case 'code_inline':
      return { kind: 'code', text: token.content };
    case 'wiki_link': {
      const meta = token.meta as WikiLinkMeta;
      return { kind: 'wikiLink', text: token.content, target: meta.target, embed: meta.embed };
    }
    default:
      return undefined;
  }
}

/** Adds a token, joining text to the text before it and dropping empty text. */
function appendToken(tokens: InlineToken[], token: InlineToken | undefined): void {
  if (token?.kind !== 'text') {
    if (token) {
      tokens.push(token);
    }
    return;
  }
  if (token.text === '') {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last?.kind === 'text') {
    tokens[tokens.length - 1] = { kind: 'text', text: last.text + token.text };
    return;
  }
  tokens.push(token);
}
