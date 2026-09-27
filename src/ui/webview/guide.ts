import MarkdownIt = require('markdown-it');
import sanitizeHtml = require('sanitize-html');

/**
 * The guide: docs/guide, one Markdown page per topic, shipped in the VSIX.
 *
 * Help is the quick glance and each of its sections ends with Read more,
 * which shows the page here that goes into detail, inside the Help panel.
 * The same files are read on GitHub and built into the GitHub Pages site,
 * so they link one another with relative `.md` links and reach screenshots
 * as `../images/…`; this rewrites both for the panel.
 */

/** Every guide page, by file name without `.md`, with its title. */
export const GUIDE_PAGES: Readonly<Record<string, string>> = {
  README: 'Deckard guide',
  'getting-started': 'Getting started',
  'notes-and-links': 'Writing notes: tags, people, and links',
  tasks: 'Tasks',
  'task-board': 'Task board',
  search: 'Search',
  'search-pages': 'Search pages and tag overviews',
  'query-blocks': 'Query blocks',
  'home-and-stats': 'Home and Stats',
  connections: 'Related notes, the graph, and the outline',
  'daily-notes': 'Daily notes, reviews, and the calendar',
  organizing: 'Renaming, moving, and parking',
  'themes-and-zen': 'Themes and Zen mode',
  'ai-assistants': 'AI assistants',
  commands: 'Commands',
  settings: 'Settings',
  'privacy-and-troubleshooting': 'Privacy, source safety, and troubleshooting',
};

/** The guide page, and the heading on it, each Help section's Read more opens. */
export const HELP_READ_MORE: Readonly<Record<string, { page: string; anchor?: string }>> = {
  'quick-start': { page: 'getting-started' },
  tags: { page: 'notes-and-links' },
  frontmatter: { page: 'notes-and-links' },
  links: { page: 'notes-and-links' },
  boundaries: { page: 'notes-and-links' },
  tasks: { page: 'tasks' },
  'task-metadata': { page: 'tasks', anchor: 'task-metadata' },
  'task-views': { page: 'task-board' },
  search: { page: 'search' },
  query: { page: 'search', anchor: 'query-language' },
  'query-blocks': { page: 'query-blocks' },
  connections: { page: 'connections' },
  home: { page: 'home-and-stats' },
  tidy: { page: 'organizing' },
  periodic: { page: 'daily-notes' },
  zen: { page: 'themes-and-zen', anchor: 'zen-mode' },
  commands: { page: 'commands' },
  advanced: { page: 'settings' },
  assistants: { page: 'ai-assistants' },
  privacy: { page: 'privacy-and-troubleshooting' },
};

/** Where the screenshots are served from: the images the guide points at, on GitHub. */
export const GUIDE_IMAGE_BASE = 'https://raw.githubusercontent.com/doctorallen/deckard/master/docs/images/';
/** Where a file outside the guide, such as the README, is read instead. */
const REPOSITORY_BASE = 'https://github.com/doctorallen/deckard/blob/master/';

export function isGuidePage(page: string): boolean {
  return Object.prototype.hasOwnProperty.call(GUIDE_PAGES, page);
}

/** A heading's anchor as GitHub writes it, so links written for GitHub land. */
export function guideSlug(text: string): string {
  return text
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');
}

const markdown = new MarkdownIt({ html: true, linkify: false });

type LinkTarget =
  | { kind: 'page'; page: string; anchor?: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'changelog' }
  | { kind: 'external'; href: string };

/** What a link in a guide page points at, from the panel's side. */
export function resolveGuideLink(href: string): LinkTarget {
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
  const inRepository = path.startsWith('../../') ? path.slice(6) : path.startsWith('../') ? `docs/${path.slice(3)}` : `docs/guide/${path}`;
  return { kind: 'external', href: REPOSITORY_BASE + inRepository + (anchor ? `#${anchor}` : '') };
}

function linkAttributes(href: string): Record<string, string> {
  const target = resolveGuideLink(href);
  switch (target.kind) {
    case 'page':
      return { href: '#', 'data-guide-page': target.page, ...(target.anchor ? { 'data-guide-anchor': target.anchor } : {}) };
    case 'anchor':
      return { href: '#', 'data-guide-anchor': target.anchor };
    case 'changelog':
      return { href: '#', 'data-action': 'open-changelog' };
    case 'external':
      return { href: target.href };
  }
}

function imageSource(src: string): string {
  return src.startsWith('../images/') ? GUIDE_IMAGE_BASE + src.slice('../images/'.length) : src;
}

/**
 * A guide page as the Help panel shows it: headings carry the anchors GitHub
 * gives them, links between pages stay in the panel, and screenshots load
 * from GitHub, since the VSIX leaves them out to stay small.
 */
export function renderGuidePage(source: string): string {
  const tokens = markdown.parse(source, {});
  tokens.forEach((token, at) => {
    if (token.type === 'heading_open') {
      const inline = tokens[at + 1];
      token.attrSet('id', guideSlug(inline?.content ?? ''));
    }
    const walk = (children: typeof tokens): void => {
      children.forEach((child) => {
        if (child.type === 'link_open') {
          const attributes = linkAttributes(child.attrGet('href') ?? '');
          child.attrs = Object.entries(attributes);
        } else if (child.type === 'image') {
          child.attrSet('src', imageSource(child.attrGet('src') ?? ''));
        } else if (child.type === 'html_inline') {
          child.content = rewriteHtml(child.content);
        }
      });
    };
    if (token.children) {
      walk(token.children);
    }
    if (token.type === 'html_block') {
      token.content = rewriteHtml(token.content);
    }
  });
  return sanitizeGuideHtml(markdown.renderer.render(tokens, markdown.options, {}));
}

/** The few raw HTML tags the pages hold, such as the themes' screenshot table. */
function rewriteHtml(html: string): string {
  return html
    .replace(/src="(\.\.\/images\/[^"]+)"/g, (_all, src: string) => `src="${imageSource(src)}"`)
    .replace(/href="([^"]+)"/g, (_all, href: string) =>
      Object.entries(linkAttributes(href)).map(([name, value]) => `${name}="${value}"`).join(' '),
    );
}

function sanitizeGuideHtml(html: string): string {
  const headingAttributes = ['id'];
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'hr', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'b', 'i', 'kbd', 'sup', 'sub',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'data-guide-page', 'data-guide-anchor', 'data-action'],
      img: ['src', 'alt', 'width', 'height'],
      h1: headingAttributes,
      h2: headingAttributes,
      h3: headingAttributes,
      h4: headingAttributes,
      h5: headingAttributes,
      h6: headingAttributes,
      td: ['align'],
      th: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
  });
}
