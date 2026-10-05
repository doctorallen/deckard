/**
 * The guide: docs/guide, one Markdown page per topic, shipped in the VSIX.
 *
 * Help is the quick glance and each of its sections ends with Read more,
 * which shows the page here that goes into detail, inside the Help panel.
 * The same files are read on GitHub and built into the GitHub Pages site,
 * so they link one another with relative `.md` links and reach screenshots
 * as `../images/…`; `pages/help/guideLinks.ts` rewrites both for the panel.
 * This is the guide's catalog: its pages, and where Help's sections lead.
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
  zen: { page: 'themes-and-zen', anchor: 'display' },
  commands: { page: 'commands' },
  advanced: { page: 'settings' },
  assistants: { page: 'ai-assistants' },
  privacy: { page: 'privacy-and-troubleshooting' },
};

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
