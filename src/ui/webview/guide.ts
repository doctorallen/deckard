/**
 * The guide: docs/guide, one Markdown page per topic, shipped in the VSIX.
 *
 * Help is the guide: its side lists the pages as the guide's own contents,
 * docs/guide/README.md, lists them, and each shows in the Help panel.
 * The same files are read on GitHub and built into the GitHub Pages site,
 * so they link one another with relative `.md` links and reach screenshots
 * as `../images/…`; `pages/help/guideLinks.ts` rewrites both for the panel.
 * This is the guide's catalog: its pages, their contents, and where each
 * place Help is opened at, by name, leads.
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
  'themes-and-zen': 'Themes and Display',
  'ai-assistants': 'AI assistants',
  commands: 'Commands',
  settings: 'Settings',
  'privacy-and-troubleshooting': 'Privacy, source safety, and troubleshooting',
  security: 'For your security reviewer',
  'what-deckard-writes': 'What Deckard writes',
  accessibility: 'Accessibility and keyboard',
};

/** Help's own page beside the guide's: the highlights of recent releases, drawn from the changelog. */
export const WHATS_NEW = 'whats-new';

/**
 * The guide's contents, as docs/guide/README.md lists them: the groups in
 * order, each with its pages in order. The README's Changelog is What's
 * new in Help. The guide test holds this to the README.
 */
export const GUIDE_CONTENTS: ReadonlyArray<{ group: string; pages: readonly string[] }> = [
  { group: 'Start', pages: ['getting-started', 'themes-and-zen'] },
  { group: 'Writing', pages: ['notes-and-links', 'tasks', 'daily-notes', 'organizing'] },
  { group: 'Finding', pages: ['search', 'search-pages', 'query-blocks', 'connections'] },
  { group: 'Seeing the whole', pages: ['task-board', 'home-and-stats', 'ai-assistants'] },
  {
    group: 'Reference',
    pages: ['commands', 'settings', 'privacy-and-troubleshooting', 'security', 'what-deckard-writes', 'accessibility', WHATS_NEW],
  },
];

/** A place in Help: a guide page, or What's new, at a heading when one is named. */
export interface HelpPlace {
  page: string;
  anchor?: string;
}

/**
 * The places Help was opened at by name before it showed only the guide,
 * each its section of the old quick glance, and the guide page and heading
 * that hold what it said. Pages and `deckard.showHelp` still name them,
 * such as the calendar's `periodic`.
 */
export const HELP_SECTIONS: Readonly<Record<string, HelpPlace>> = {
  'quick-start': { page: 'getting-started' },
  tags: { page: 'notes-and-links', anchor: 'tags-and-people' },
  frontmatter: { page: 'notes-and-links', anchor: 'markdown-format' },
  links: { page: 'notes-and-links', anchor: 'markdown-format' },
  boundaries: { page: 'notes-and-links', anchor: 'what-is-a-note' },
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
  zen: { page: 'themes-and-zen', anchor: 'display' },
  commands: { page: 'commands' },
  advanced: { page: 'settings' },
  assistants: { page: 'ai-assistants' },
  privacy: { page: 'privacy-and-troubleshooting' },
};

/**
 * Where Help opens for a name it is asked for: What's new, an old section
 * by its name, or a guide page by its file name. Anything else, and no
 * name, opens the guide's contents.
 */
export function helpPlace(name: string | undefined): HelpPlace {
  if (name === WHATS_NEW) {
    return { page: WHATS_NEW };
  }
  if (name && Object.prototype.hasOwnProperty.call(HELP_SECTIONS, name)) {
    return HELP_SECTIONS[name];
  }
  return { page: name && isGuidePage(name) ? name : 'README' };
}

/** Whether the guide has a page by this file name, without `.md`. */
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
