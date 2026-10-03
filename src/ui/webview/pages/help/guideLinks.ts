/**
 * The guide's links and screenshots, rewritten for the Help panel.
 *
 * The pages of docs/guide are read on GitHub and built into the site as
 * well, so they link one another with relative `.md` links and reach
 * screenshots as `../images/…`. In the panel, a link to another page asks
 * the host for it, a link to a heading scrolls to it, the changelog opens in
 * the preview, and anything else in the repository is read on GitHub, where
 * the screenshots are loaded from too, since the VSIX leaves them out to stay
 * small.
 *
 * This works over the HTML VS Code's Markdown engine returns from
 * `markdown.api.render` (decision 0012), and rewrites only what Help must:
 * each link's attributes, each image's source, and the empty Mermaid span
 * the engine leads with. The rest, such as `data-line`, `class="code-line"`,
 * `dir="auto"`, and highlighted code's `hljs-*` spans, is left as it came,
 * since no rule of Help's styles it.
 */
import { escapeHtml } from '../../../../shared/html';
import { isGuidePage } from '../../guide';

/** Where the screenshots are served from: the images the guide points at, on GitHub. */
export const GUIDE_IMAGE_BASE = 'https://raw.githubusercontent.com/doctorallen/deckard/master/docs/images/';
/** Where a file outside the guide, such as the README, is read instead. */
const REPOSITORY_BASE = 'https://github.com/doctorallen/deckard/blob/master/';

/** What a link in a guide page points at, from the panel's side. */
export type GuideLinkTarget =
  | { kind: 'page'; page: string; anchor?: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'changelog' }
  | { kind: 'external'; href: string };

/** What a link in a guide page points at, from the panel's side. */
export function resolveGuideLink(href: string): GuideLinkTarget {
  if (/^(https?:|mailto:)/.test(href)) {
    return { kind: 'external', href };
  }
  if (href.startsWith('#')) {
    return { kind: 'anchor', anchor: href.slice(1) };
  }
  const [path, anchor] = href.split('#', 2);
  const page = /^(?:\.\/)?([\w-]+)\.md$/.exec(path)?.[1];
  if (page && isGuidePage(page)) {
    return { kind: 'page', page, ...(anchor ? { anchor } : {}) };
  }
  if (path === '../../CHANGELOG.md') {
    return { kind: 'changelog' };
  }
  // Anything else in the repository, such as the README or LICENSE, is read
  // on GitHub, where the rest of the repository is.
  return { kind: 'external', href: REPOSITORY_BASE + inRepository(path) + (anchor ? `#${anchor}` : '') };
}

/** Where a path written from docs/guide is in the repository. */
function inRepository(path: string): string {
  if (path.startsWith('../../')) {
    return path.slice(6);
  }
  if (path.startsWith('../')) {
    return `docs/${path.slice(3)}`;
  }
  return `docs/guide/${path}`;
}

/** A link's attributes in the panel, in place of every attribute it had. */
function linkAttributes(href: string): Array<[string, string]> {
  const target = resolveGuideLink(href);
  switch (target.kind) {
    case 'page':
      return [['href', '#'], ['data-guide-page', target.page], ...(target.anchor ? [['data-guide-anchor', target.anchor] as [string, string]] : [])];
    case 'anchor':
      return [['href', '#'], ['data-guide-anchor', target.anchor]];
    case 'changelog':
      return [['href', '#'], ['data-action', 'open-changelog']];
    case 'external':
      return [['href', target.href]];
  }
}

/** A screenshot's source in the panel: the guide's own images load from GitHub. */
function imageSource(src: string): string {
  return src.startsWith('../images/') ? GUIDE_IMAGE_BASE + src.slice('../images/'.length) : src;
}

/** What an image keeps besides its source: what the panel drew before 0012. */
const IMAGE_ATTRIBUTES = new Set(['src', 'alt', 'width', 'height']);

/** The entities the engine and the guide's own HTML write in an attribute. */
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

/** An attribute's value as text, its entities read back. */
function decodeAttribute(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_whole, name: string) => ENTITIES[name]);
}

/** A tag's attributes, from the text between its name and `>`, in order, their values read back. */
function readAttributes(text: string): Array<[string, string]> {
  return [...text.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((match) => [
    match[1].toLowerCase(),
    decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ''),
  ]);
}

/** Attributes written back as a tag's text, each value escaped. */
function writeAttributes(attributes: ReadonlyArray<[string, string]>): string {
  return attributes.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
}

/**
 * A guide page's HTML, from `markdown.api.render`, as the Help panel shows
 * it: the engine's Mermaid span gone, each link given the attributes that
 * keep it inside the panel or send it to GitHub (its `data-href` and title
 * with the rest), and each screenshot loaded from GitHub. The guide's own
 * raw HTML, such as the themes' screenshot table, is rewritten alike.
 */
export function rewriteGuideHtml(html: string): string {
  return html
    .replace(/<span id="markdown-mermaid"[^>]*><\/span>\s*/g, '')
    .replace(/<a\b([^>]*)>/gi, (whole, text: string) => {
      const href = readAttributes(text).find(([name]) => name === 'href')?.[1];
      return href === undefined ? whole : `<a${writeAttributes(linkAttributes(href))}>`;
    })
    .replace(/<img\b([^>]*?)\s*\/?>/gi, (_whole, text: string) => {
      const attributes = readAttributes(text)
        .filter(([name]) => IMAGE_ATTRIBUTES.has(name))
        .map(([name, value]): [string, string] => [name, name === 'src' ? imageSource(value) : value]);
      return `<img${writeAttributes(attributes)}>`;
    });
}
