import MarkdownIt = require('markdown-it');

import {
  BLOCK_ID_PATTERN,
  findFencedLines,
  parseMarkdown,
} from '../../core/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  findLinkedSection,
  noteTitle,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../core/workspace/backlinks';
import { createPreviewSourceHref } from './queryBlockHtml';

/**
 * Draws `![[Note]]`, `![[Note#Heading]]`, and `![[Note#^id]]` in VS Code's
 * Markdown preview as the note, section, or line they name.
 *
 * Links to a heading or a marked line already resolve, complete, preview on
 * hover, and count as backlinks; an embed is the same reference read in
 * place. It needs no minted ids, which is the part Deckard deliberately
 * leaves out: what a heading or a `^marker` names is already enough.
 */

/** How deep an embed inside an embed is drawn before it becomes a link. */
const MAX_DEPTH = 3;

/** Names that are not notes, which Deckard does not embed. */
const ATTACHMENT = /\.(?:png|jpe?g|gif|svg|webp|bmp|pdf|mp4|mp3|wav|mov|webm)$/i;

const EMBED_LINE = /^ {0,3}!\[\[([^\]]+)\]\][ \t]*$/;

/**
 * The embeds in a note's source, the lines the preview would draw as one:
 * alone on their line, outside code fences, and naming a note rather than an
 * attachment.
 */
export function findEmbedLines(
  content: string,
): { line: number; target: string }[] {
  const lines = content.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  return lines.flatMap((text, line) => {
    const match = fenced.has(line) ? null : EMBED_LINE.exec(text);
    return match && !ATTACHMENT.test(parseWikiTarget(match[1]).note)
      ? [{ line, target: match[1] }]
      : [];
  });
}

export interface NoteEmbedSource {
  /** Undefined until the first workspace scan finishes. */
  getIndex(): WorkspaceIndex | undefined;
  /** Called whenever an embed draws, so the host knows to refresh previews. */
  onDidRender?(): void;
}

/** What one embed names, resolved against the index or the note itself. */
interface EmbedToken {
  /** The `[[…]]` text as written, for the fallback link. */
  target: string;
  /** The note the embed came from, so it can be read again when drawn. */
  source: string;
}

/**
 * Adds the embed rule to one preview engine. An embed sits alone on its line,
 * the way a block quote or a fence does; `![[…]]` written inside a sentence
 * stays the text its author typed.
 */
export function addNoteEmbedRenderer(
  md: MarkdownIt,
  source: NoteEmbedSource,
): MarkdownIt {
  md.block.ruler.before(
    'paragraph',
    'deckard_embed',
    (state, startLine, _endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const line = state.src.slice(start, state.eMarks[startLine]);
      const match = EMBED_LINE.exec(line);
      if (!match || ATTACHMENT.test(parseWikiTarget(match[1]).note)) {
        return false;
      }
      if (silent) {
        return true;
      }
      const token = state.push('deckard_embed', '', 0);
      token.map = [startLine, startLine + 1];
      token.markup = '![[';
      token.meta = { target: match[1], source: state.src } as EmbedToken;
      state.line = startLine + 1;
      return true;
    },
    { alt: ['paragraph', 'blockquote', 'list'] },
  );

  let depth = 0;
  md.renderer.rules.deckard_embed = (tokens, index, _options, env) => {
    const token = tokens[index];
    const meta = token.meta as EmbedToken;
    source.onDidRender?.();
    const line = token.map?.[0];
    const open =
      line === undefined
        ? '<div class="deckard-embed">'
        : `<div class="deckard-embed code-line" data-line="${line}">`;
    const embed = resolveEmbed(meta.target, meta.source, source.getIndex());

    if (embed.kind === 'missing') {
      return [
        open,
        renderHeader(meta.target, embed.href),
        `<p class="deckard-embed-message">${escapeHtml(embed.reason)}</p>`,
        '</div>',
      ].join('');
    }
    // An embed inside an embed is drawn, up to a point; past it the reader
    // gets the link, so a note embedding itself cannot spin.
    if (depth >= MAX_DEPTH) {
      return [
        open,
        renderHeader(embed.title, embed.href),
        '<p class="deckard-embed-message">Embedded too deeply to draw here.</p>',
        '</div>',
      ].join('');
    }

    depth += 1;
    let body: string;
    try {
      body = md.render(embed.content, env);
    } finally {
      depth -= 1;
    }
    return [
      open,
      renderHeader(embed.title, embed.href),
      `<div class="deckard-embed-body">${body}</div>`,
      '</div>',
    ].join('');
  };
  return md;
}

type ResolvedEmbed =
  | { kind: 'note'; title: string; content: string; href?: string }
  | { kind: 'missing'; reason: string; href?: string };

/**
 * What an embed draws: a whole note, one of its sections, or one marked
 * line. An embed with no note name reads the note it is written in, which is
 * the source the preview is rendering.
 */
export function resolveEmbed(
  target: string,
  documentSource: string,
  index: WorkspaceIndex | undefined,
): ResolvedEmbed {
  const { note, heading, block } = parseWikiTarget(target);
  if (!note && !heading && !block) {
    return { kind: 'missing', reason: 'This embed names nothing.' };
  }

  if (!note) {
    // The note embedding itself: its source is what the preview is drawing,
    // so it is read from there rather than from the index, which may be one
    // save behind.
    const file = parseSource(documentSource);
    return readFrom(file, heading, block, '', target);
  }

  if (!index) {
    return { kind: 'missing', reason: 'Deckard is indexing the workspace…' };
  }
  const titles = createNoteTitleMap(index);
  const filePath = resolveWikiTarget(titles, note, '');
  const file = filePath ? index.files.get(filePath) : undefined;
  if (!file || !filePath) {
    const names = titles.get(note.trim().toLocaleLowerCase())?.length ?? 0;
    return {
      kind: 'missing',
      reason:
        names > 1
          ? `"${note}" names ${names} notes, so this embed reads none.`
          : `No note is named "${note}" yet.`,
    };
  }
  return readFrom(file, heading, block, filePath, target);
}

/** One note, section, or marked line of a parsed note. */
function readFrom(
  file: ParsedFile,
  heading: string | undefined,
  block: string | undefined,
  filePath: string,
  target: string,
): ResolvedEmbed {
  const title = filePath ? noteTitle(filePath) : '';
  const href = (line: number): string | undefined =>
    filePath ? createPreviewSourceHref(filePath, line) : undefined;

  if (block) {
    const line = file.blockIds?.[block];
    const text =
      line === undefined ? undefined : file.content.split(/\r?\n/)[line - 1];
    if (text === undefined || line === undefined) {
      return {
        kind: 'missing',
        reason: `Nothing in ${title || 'this note'} is marked ^${block}.`,
      };
    }
    const source = href(line);
    return {
      kind: 'note',
      title: `${title}#^${block}`.replace(/^#/, ''),
      content: text.replace(BLOCK_ID_PATTERN, '').trim(),
      ...(source ? { href: source } : {}),
    };
  }

  if (heading) {
    const section = findLinkedSection(file, heading);
    return section
      ? {
          kind: 'note',
          title: `${title ? `${title} › ` : ''}${section.heading.trim()}`,
          // The section and everything nested under it, which is what a
          // reader following the link would have found there.
          content: section.rawContent,
          ...(href(section.startLine) ? { href: href(section.startLine) } : {}),
        }
      : {
          kind: 'missing',
          reason: `${title || 'This note'} has no heading "${heading}".`,
        };
  }

  return {
    kind: 'note',
    title: title || target,
    content: withoutFrontmatter(file.content),
    ...(href(1) ? { href: href(1) } : {}),
  };
}

/** The body of a note, without the front matter a reader does not need. */
export function withoutFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end < 0 ? content : lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

/**
 * The note being previewed, parsed once. A note holding several embeds parses
 * it once for all of them, and the preview redraws from the top each time.
 */
let lastSource: { content: string; file: ParsedFile } | undefined;

function parseSource(content: string): ParsedFile {
  if (lastSource?.content !== content) {
    lastSource = { content, file: parseMarkdown('', content) };
  }
  return lastSource.file;
}

function renderHeader(title: string, href?: string): string {
  const label = escapeHtml(title);
  return [
    '<div class="deckard-embed-header">',
    '<span class="deckard-embed-label">Embedded</span>',
    href
      ? `<a class="deckard-embed-title" href="${escapeHtml(href)}">${label}</a>`
      : `<span class="deckard-embed-title">${label}</span>`,
    '</div>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
