import type { ComponentChild } from 'preact';

import type { InlineToken } from '../../ui/protocol/inline';

/**
 * One token as elements and text: the HTML markdown-it wrote for it, drawn
 * as nodes, so nothing in a note is ever parsed as HTML. A line break is a
 * `<br>` and the line's end after it, as markdown-it wrote one. A wiki link
 * is its words as written, brackets and all, as the pages have always shown
 * one.
 */
function drawToken(token: InlineToken): ComponentChild {
  switch (token.kind) {
    case 'text':
    case 'wikiLink':
      return token.text;
    case 'code':
      return <code>{token.text}</code>;
    case 'break':
      return [<br />, '\n'];
    case 'link':
      // A link's title is the note's own words, which markdown-it kept on
      // the link, not a label the page gives a control of its own.
      // eslint-disable-next-line no-restricted-syntax
      return <a href={token.url} title={token.title || undefined}><Inline tokens={token.children} /></a>;
    case 'strong':
      return <strong><Inline tokens={token.children} /></strong>;
    case 'em':
      return <em><Inline tokens={token.children} /></em>;
    case 'del':
      return <del><Inline tokens={token.children} /></del>;
    case 'image':
      // Only the Note page draws images; anywhere else, the alt text.
      return token.alt;
  }
}

/**
 * Inline Markdown, such as a task's title, drawn from its token tree
 * (`domain/markdown/inline.ts`): text as text nodes, and emphasis, code,
 * breaks, and links to the web or to mail as the elements markdown-it wrote
 * for them.
 */
export function Inline({ tokens }: { readonly tokens: readonly InlineToken[] }) {
  return <>{tokens.map(drawToken)}</>;
}
