/**
 * A note excerpt drawn from its block token tree: the elements and text
 * nodes markdown-it wrote for it, less what the sanitizer took out, so a
 * card reads as it did when the host sent it as HTML, and nothing in a
 * note is ever parsed as HTML.
 */
import type { ComponentChild } from 'preact';

import type { BlockToken, InlineToken } from '../../ui/protocol/inline';
import { Inline } from './inline';

/**
 * Whether markdown-it wrote a block with its own renderer, which puts a
 * line's end before a block that follows a tight list's bare paragraph.
 * Code is written by a rule of its own, which does not.
 */
function opensWithTag(block: BlockToken, tight: boolean): boolean {
  if (block.kind === 'code') {
    return false;
  }
  return !(block.kind === 'paragraph' && tight);
}

/**
 * Whether markdown-it put a line's end after a container's opening tag:
 * not when the container is empty, and not when it opens on a tight list's
 * bare paragraph.
 */
function breaksAfterOpening(children: readonly BlockToken[], tight: boolean): boolean {
  if (!children.length) {
    return false;
  }
  return !(tight && children[0].kind === 'paragraph');
}

/**
 * A table's cells' words, as the sanitizer left them: the table's elements
 * are gone, but the line's end markdown-it wrote after each of them stays.
 * The header row is first; the body is written only when it has a row.
 */
function drawTable(rows: readonly (readonly (readonly InlineToken[])[])[]): ComponentChild[] {
  const drawRow = (row: readonly (readonly InlineToken[])[]): ComponentChild[] => [
    '\n',
    ...row.flatMap((cell) => [<Inline tokens={cell} />, '\n']),
    '\n',
  ];
  const [header, ...body] = rows;
  const drawn: ComponentChild[] = ['\n', '\n', ...(header ? drawRow(header) : []), '\n'];
  if (body.length) {
    drawn.push('\n', ...body.flatMap(drawRow), '\n');
  }
  drawn.push('\n');
  return drawn;
}

/** A list, its items' blocks each in an item, tight or loose as markdown-it read it. */
function drawList(block: Extract<BlockToken, { kind: 'list' }>): ComponentChild {
  const items = block.items.map((item) => (
    <>
      <li>{breaksAfterOpening(item, block.tight) ? '\n' : null}{drawBlocks(item, block.tight)}</li>
      {'\n'}
    </>
  ));
  return block.ordered ? <ol>{'\n'}{items}</ol> : <ul>{'\n'}{items}</ul>;
}

/** One block as markdown-it wrote it, with the line's end it wrote after it. */
function drawBlock(block: BlockToken, tight: boolean): ComponentChild {
  switch (block.kind) {
    case 'paragraph':
      return tight ? <Inline tokens={block.children} /> : <><p><Inline tokens={block.children} /></p>{'\n'}</>;
    case 'heading': {
      const Heading = `h${block.level}` as const;
      return <><Heading><Inline tokens={block.children} /></Heading>{'\n'}</>;
    }
    case 'list':
      return <>{drawList(block)}{'\n'}</>;
    case 'code':
      return <><pre><code>{block.text}</code></pre>{'\n'}</>;
    case 'quote':
      return <><blockquote>{breaksAfterOpening(block.children, false) ? '\n' : null}{drawBlocks(block.children, false)}</blockquote>{'\n'}</>;
    case 'rule':
      return <><hr />{'\n'}</>;
    case 'table':
      return <>{drawTable(block.rows)}</>;
  }
}

/**
 * Blocks in order. In a tight list an item's paragraphs are bare text, and
 * markdown-it put a line's end between such a paragraph and a block it
 * wrote after it.
 */
function drawBlocks(blocks: readonly BlockToken[], tight: boolean): ComponentChild[] {
  const drawn: ComponentChild[] = [];
  let afterBare = false;
  for (const block of blocks) {
    if (afterBare && opensWithTag(block, tight)) {
      drawn.push('\n');
    }
    drawn.push(drawBlock(block, tight));
    afterBare = tight && block.kind === 'paragraph';
  }
  return drawn;
}

/**
 * A note excerpt, such as a card's body, drawn from its block tokens
 * (`domain/markdown/blockExcerpt.ts`): paragraphs, headings, lists, code,
 * quotes, and rules as markdown-it's elements, and a table as its cells'
 * words, which is all the sanitizer ever left of one.
 */
export function BlockExcerpt({ blocks }: { readonly blocks: readonly BlockToken[] }) {
  return <>{drawBlocks(blocks, false)}</>;
}
