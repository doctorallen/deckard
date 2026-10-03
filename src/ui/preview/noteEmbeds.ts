import type MarkdownIt from 'markdown-it';

import { parseWikiTarget } from '../../domain/index/backlinks';
import { ATTACHMENT } from '../../domain/markdown/noteNames';
import {
  createSourceParser,
  EMBED_LINE,
  resolveEmbed,
} from '../../domain/notes/embeds';
import { escapeHtml } from '../../shared/html';
import { WorkspaceIndex } from '../../domain/model';

/** How deep an embed inside an embed is drawn before it becomes a link. */
const MAX_DEPTH = 3;

/**
 * What the embed rule needs from the extension host: the index to resolve a
 * target against, and a way to say a preview has drawn one.
 */
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
 * Adds the embed rule to one preview engine, which draws `![[Note]]`,
 * `![[Note#Heading]]`, and `![[Note#^id]]` as the note, section, or line they
 * name. An embed sits alone on its line, the way a block quote or a fence
 * does; `![[…]]` written inside a sentence stays the text its author typed.
 *
 * Links to a heading or a marked line already resolve, complete, preview on
 * hover, and count as backlinks; an embed is the same reference read in
 * place. It needs no minted ids, which is the part Deckard deliberately
 * leaves out: what a heading or a `^marker` names is already enough.
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
  // The note being previewed, parsed once for every embed of itself.
  const parseSource = createSourceParser();
  md.renderer.rules.deckard_embed = (tokens, index, _options, env) => {
    const token = tokens[index];
    const meta = token.meta as EmbedToken;
    source.onDidRender?.();
    const line = token.map?.[0];
    const open =
      line === undefined
        ? '<div class="deckard-embed">'
        : `<div class="deckard-embed code-line" data-line="${line}">`;
    const embed = resolveEmbed(meta.target, meta.source, source.getIndex(), parseSource);

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

/**
 * The line above an embed that names what it shows, linked to its source
 * when there is one to open.
 */
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
