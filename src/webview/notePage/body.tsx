/**
 * A note's blocks, drawn from the tokens its host read: each block an
 * element carrying the line it starts on, so a double-click opens the
 * editor there and a line asked for is found; tags and `[[links]]` as
 * controls; tasks with working boxes; query blocks as their results; and
 * embeds as what they name. Nothing in a note is ever parsed as HTML.
 */
import type { ComponentChild } from 'preact';

import type { InlineToken } from '../../ui/protocol/inline';
import type { NoteBlock, NoteEmbedBlock, NoteListItem, NoteQueryResult, NoteQueryRow, NoteTaskBox } from '../../ui/protocol/notePage';
import type { TagReference } from '../../ui/protocol/shared';
import { withTagButtons } from '../shared/tagButton';

/** What drawing a note's blocks reads besides the blocks: its tags, and the note an embed's blocks are from. */
export interface BodyContext {
  readonly tags: readonly TagReference[];
  /** The note the blocks are from, when they are an embed's rather than the page's own. */
  readonly filePath?: string;
}

/** The attributes that say where a block starts. */
function at(line: number, context: BodyContext): Record<string, string | number> {
  return context.filePath ? { 'data-line': line, 'data-file-path': context.filePath } : { 'data-line': line };
}

/**
 * What a `[[link]]` reads as on the page: the words after its `|` when it
 * has them, or the note it names and the heading or line after "›".
 */
function linkWords(written: string): string {
  const inner = written.replace(/^\[\[|\]\]$/g, '');
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    return inner.slice(bar + 1).trim();
  }
  return inner.replace(/#\^?/, ' › ').replace(/^ › /, '');
}

/** One inline token as elements and text, a tag a button and a `[[link]]` a control that opens it. */
function drawToken(token: InlineToken, context: BodyContext): ComponentChild {
  switch (token.kind) {
    case 'text':
      return withTagButtons(token.text, context.tags, false) ?? token.text;
    case 'wikiLink':
      return token.embed
        ? token.text
        : (
          <button type="button" class="note-link" data-action="open-link" data-target={token.target} data-from={context.filePath} data-tip={`Open ${token.target} · Shift-click: the other way`}>
            {linkWords(token.text)}
          </button>
        );
    case 'code':
      return <code>{token.text}</code>;
    case 'break':
      return <br />;
    case 'link':
      // A link's title is the note's own words.
      // eslint-disable-next-line no-restricted-syntax
      return <a href={token.url} title={token.title || undefined}><InlineTokens tokens={token.children} context={context} /></a>;
    case 'strong':
      return <strong><InlineTokens tokens={token.children} context={context} /></strong>;
    case 'em':
      return <em><InlineTokens tokens={token.children} context={context} /></em>;
    case 'del':
      return <del><InlineTokens tokens={token.children} context={context} /></del>;
    case 'image':
      return <NoteImage token={token} />;
  }
}

/**
 * An image the host read into a `data:` URI, drawn at the column's width;
 * selecting it shows it at full size, and again fits it back. One the host
 * could not read says why, with its path, where it would have been.
 */
function NoteImage({ token }: { readonly token: Extract<InlineToken, { kind: 'image' }> }) {
  if (token.missing || !token.src.startsWith('data:')) {
    return <span class="note-image-missing">{`Image not shown: ${token.alt || token.src} (${token.missing ?? 'not read'})`}</span>;
  }
  return (
    <button type="button" class="note-image-button" data-action="toggle-image-size" aria-label={`${token.alt || 'Image'}, shown fitted; select to show at full size`}>
      <img class="note-image" src={token.src} alt={token.alt} />
    </button>
  );
}

/** Inline Markdown, with the note's tags and links as controls. */
export function InlineTokens({ tokens, context }: { readonly tokens: readonly InlineToken[]; readonly context: BodyContext }) {
  return <>{tokens.map((token) => drawToken(token, context))}</>;
}

/** A task's box, which completes or reopens it, named for what it does. */
function TaskBox({ task, label }: { readonly task: NoteTaskBox; readonly label: string }) {
  return (
    <input
      type="checkbox"
      class="note-task-box"
      data-action="toggle-task"
      data-task-id={task.taskId}
      checked={task.completed}
      aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${label}`}
    />
  );
}

/** Inline tokens' words, for a label. */
function wordsOf(tokens: readonly InlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.kind === 'break') {
        return ' ';
      }
      if (token.kind === 'image') {
        return token.alt;
      }
      return 'children' in token ? wordsOf(token.children) : token.text;
    })
    .join('')
    .trim();
}

/** One list item: its box when it is a task, then its blocks. */
function ListItem({ item, context }: { readonly item: NoteListItem; readonly context: BodyContext }) {
  if (!item.task) {
    return <li {...at(item.line, context)}><Blocks blocks={item.blocks} context={context} /></li>;
  }
  const [first, ...rest] = item.blocks;
  const words = first && first.kind === 'paragraph' ? wordsOf(first.children) : '';
  return (
    <li class={item.task.completed ? 'note-task is-done' : 'note-task'} {...at(item.line, context)}>
      <TaskBox task={item.task} label={words} />
      <div class="note-task-body">
        {first && first.kind === 'paragraph' ? <span class="note-task-title"><InlineTokens tokens={first.children} context={context} /></span> : null}
        <Blocks blocks={first && first.kind === 'paragraph' ? rest : item.blocks} context={context} />
      </div>
    </li>
  );
}

/** A row a query block lists, which opens what it names. */
function QueryRow({ row }: { readonly row: NoteQueryRow }) {
  return (
    <li class={row.task?.completed ? 'note-query-row is-done' : 'note-query-row'}>
      {row.task ? <TaskBox task={row.task} label={row.title} /> : null}
      <div class="note-query-body">
        <button type="button" class="note-query-title" data-action="open-note" data-file-path={row.filePath} data-line={row.line}>{row.title}</button>
        {row.detail ? <span class="note-query-detail">{row.detail}</span> : null}
      </div>
    </li>
  );
}

/** Rows as a table: the title, which opens what it names, then the cells. */
function QueryTable({ head, rows }: { readonly head: readonly string[]; readonly rows: readonly NoteQueryRow[] }) {
  if (!rows.length) {
    return null;
  }
  return (
    <div class="note-table-scroll">
      <table class="note-table">
        <thead><tr><th scope="col">{rows[0].task ? 'Task' : 'Entry'}</th>{head.map((label) => <th scope="col">{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr class={row.task?.completed ? 'is-done' : undefined}>
              <td>
                {row.task ? <TaskBox task={row.task} label={row.title} /> : null}
                <button type="button" class="note-query-title" data-action="open-note" data-file-path={row.filePath} data-line={row.line}>{row.title}</button>
              </td>
              {(row.cells ?? []).map((cell) => <td>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A query block's notes or tasks: a table under its headings, or a list. */
function QueryRows({ rows, head }: { readonly rows: readonly NoteQueryRow[]; readonly head: readonly string[] | undefined }) {
  if (head) {
    return <QueryTable head={head} rows={rows} />;
  }
  return rows.length ? <ul class="note-query-list">{rows.map((row) => <QueryRow row={row} />)}</ul> : null;
}

/** A query block as its results: lists, or tables for `view=table`, or why it cannot run. */
function QueryBlock({ query, result, line, context }: { readonly query: string; readonly result: NoteQueryResult; readonly line: number; readonly context: BodyContext }) {
  const more = (shown: number, total: number, noun: string): ComponentChild =>
    total > shown ? <p class="note-query-more">{`Showing ${shown} of ${total} ${noun}.`}</p> : null;
  return (
    <section class="note-query" {...at(line, context)} aria-label={`Query: ${query}`}>
      <header class="note-query-header">
        <span class="eyebrow">Query</span>
        <code class="note-query-text">{query}</code>
        {result.counts ? <span class="note-query-counts">{result.counts}</span> : null}
      </header>
      {result.error ? <p class="note-query-error" role="alert">{result.error}</p> : null}
      {!result.error && !result.noteCount && !result.taskCount ? <p class="note-query-more">Nothing matches this query yet.</p> : null}
      <QueryRows rows={result.notes} head={result.table?.noteHead} />
      {more(result.notes.length, result.noteCount, 'notes')}
      <QueryRows rows={result.tasks} head={result.table?.taskHead} />
      {more(result.tasks.length, result.taskCount, 'tasks')}
    </section>
  );
}

/** An embed: what it names, under a title that opens it, or why it names nothing. */
function Embed({ block, context }: { readonly block: NoteEmbedBlock; readonly context: BodyContext }) {
  const source = block.source;
  return (
    <section class={block.missing ? 'note-embed is-missing' : 'note-embed'} {...at(block.line, context)} aria-label={`Embedded: ${block.title}`}>
      <header class="note-embed-header">
        {source
          ? <button type="button" class="note-embed-title" data-action="open-note" data-file-path={source.filePath} data-line={source.line}>{block.title}</button>
          : <span class="note-embed-title">{block.title}</span>}
      </header>
      {block.missing ? <p class="note-embed-missing">{block.missing}</p> : null}
      {block.blocks ? <Blocks blocks={block.blocks} context={{ tags: block.tags ?? context.tags, filePath: source?.filePath ?? context.filePath }} /> : null}
    </section>
  );
}

/** A table, its header row first. */
function Table({ rows, line, context }: { readonly rows: readonly (readonly (readonly InlineToken[])[])[]; readonly line: number; readonly context: BodyContext }) {
  const [header, ...body] = rows;
  return (
    <div class="note-table-scroll" {...at(line, context)}>
      <table class="note-table">
        {header ? <thead><tr>{header.map((cell) => <th scope="col"><InlineTokens tokens={cell} context={context} /></th>)}</tr></thead> : null}
        <tbody>{body.map((row) => <tr>{row.map((cell) => <td><InlineTokens tokens={cell} context={context} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** One block. */
function Block({ block, context }: { readonly block: NoteBlock; readonly context: BodyContext }) {
  switch (block.kind) {
    case 'paragraph':
      return <p {...at(block.line, context)}><InlineTokens tokens={block.children} context={context} /></p>;
    case 'heading': {
      const Heading = `h${Math.min(6, block.level + 1)}` as 'h2';
      return <Heading class="note-heading" {...at(block.line, context)}><InlineTokens tokens={block.children} context={context} /></Heading>;
    }
    case 'list': {
      const items = block.items.map((item) => <ListItem item={item} context={context} />);
      const hasTasks = block.items.some((item) => item.task);
      return block.ordered
        ? <ol start={block.start} class={hasTasks ? 'has-tasks' : undefined} {...at(block.line, context)}>{items}</ol>
        : <ul class={hasTasks ? 'has-tasks' : undefined} {...at(block.line, context)}>{items}</ul>;
    }
    case 'code':
      return <pre class="note-code" {...at(block.line, context)}><code>{block.text}</code></pre>;
    case 'quote':
      return <blockquote {...at(block.line, context)}><Blocks blocks={block.children} context={context} /></blockquote>;
    case 'rule':
      return <hr {...at(block.line, context)} />;
    case 'table':
      return <Table rows={block.rows} line={block.line} context={context} />;
    case 'query':
      return <QueryBlock query={block.query} result={block.result} line={block.line} context={context} />;
    case 'embed':
      return <Embed block={block} context={context} />;
  }
}

/** Blocks in order. */
export function Blocks({ blocks, context }: { readonly blocks: readonly NoteBlock[]; readonly context: BodyContext }) {
  return <>{blocks.map((block) => <Block block={block} context={context} />)}</>;
}
