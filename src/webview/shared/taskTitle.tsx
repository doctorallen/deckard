import type { ComponentChild } from 'preact';

import type { InlineToken } from '../../ui/protocol/inline';
import type { TagReference } from '../../ui/protocol/shared';
import { Inline } from './inline';
import { withTagButtons } from './tagButton';

/**
 * A run of words as one text node draws it, with the tags written in it as
 * controls; the words as they are when they write none.
 */
function decorate(text: string, tags: readonly TagReference[]): ComponentChild[] {
  return withTagButtons(text, tags, false) ?? [text];
}

/**
 * Tokens drawn as `Inline` draws them, with each run of words between two
 * elements taken as the one text node markdown-it's HTML made of it, so a
 * tag is found in it where the template found it: in text and code, and
 * never inside a link.
 */
function drawWithTags(tokens: readonly InlineToken[], tags: readonly TagReference[]): ComponentChild[] {
  const drawn: ComponentChild[] = [];
  let run = '';
  const flush = (): void => {
    if (run) {
      drawn.push(...decorate(run, tags));
    }
    run = '';
  };
  for (const token of tokens) {
    switch (token.kind) {
      case 'text':
      case 'wikiLink':
        run += token.text;
        break;
      case 'image':
        // Only the Note page draws images; a title shows the alt text.
        run += token.alt;
        break;
      case 'break':
        flush();
        drawn.push(<br />);
        // markdown-it wrote the line's end after the break, in the next text.
        run = '\n';
        break;
      case 'code':
        flush();
        drawn.push(<code>{decorate(token.text, tags)}</code>);
        break;
      case 'link':
        flush();
        drawn.push(<Inline tokens={[token]} />);
        break;
      case 'strong':
        flush();
        drawn.push(<strong>{drawWithTags(token.children, tags)}</strong>);
        break;
      case 'em':
        flush();
        drawn.push(<em>{drawWithTags(token.children, tags)}</em>);
        break;
      case 'del':
        flush();
        drawn.push(<del>{drawWithTags(token.children, tags)}</del>);
        break;
    }
  }
  flush();
  return drawn;
}

/**
 * A task's title: its inline Markdown, with the tags written in it drawn
 * as the controls that open them, where they are written. With no tags it
 * is the Markdown alone.
 */
export function TaskTitle({ tokens, tags }: { readonly tokens: readonly InlineToken[]; readonly tags?: readonly TagReference[] }) {
  if (!tags || !tags.length) {
    return <Inline tokens={tokens} />;
  }
  return <>{drawWithTags(tokens, tags)}</>;
}
