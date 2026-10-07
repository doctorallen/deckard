import { GUIDE_CONTENTS, GUIDE_PAGES, type HelpPlace, WHATS_NEW } from './guide';
import { createNonce, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';
import { compareVersions, Release, releasesWithHighlights, renderHighlightHtml } from '../../core/changelog';
import { escapeHtml } from '../../shared/html';
import { GUIDE_IMAGE_BASE } from './pages/help/guideLinks';

/** What a Help page is drawn for: the look it is drawn in, What's new's releases, and where it opens. */
export interface HelpOptions {
  /** The shipped changelog's releases, for What's new. */
  releases?: readonly Release[];
  /** The version the reader updated from: releases after it are marked New. */
  newSince?: string;
  /** Where the page opens once it has loaded; the guide's contents without. */
  place?: HelpPlace;
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome;
}

/** How many releases What's new lists. */
const WHATS_NEW_RELEASES = 5;

/** Help's What's new: the Highlights of recent releases, newest first. */
export function renderWhatsNew(releases: readonly Release[], newSince?: string): string {
  const listed = releasesWithHighlights(releases, undefined, '99999.0.0').slice(0, WHATS_NEW_RELEASES);
  const changelog =
    '<p><button type="button" data-action="open-changelog">Full changelog</button></p>';
  if (listed.length === 0) {
    return `<p>This version's changes are listed in the changelog.</p>${changelog}`;
  }
  return `<p>What's new: the highlights of recent releases, newest first. The full changelog has every change.</p>${listed
    .map(
      (release) =>
        `<h2>${escapeHtml(release.version)}${release.date ? ` · ${escapeHtml(release.date)}` : ''}${
          newSince && compareVersions(release.version, newSince) > 0
            ? ' <span class="whats-new-chip">New</span>'
            : ''
        }</h2><ul>${release.highlights.map((text) => `<li>${renderHighlightHtml(text)}</li>`).join('')}</ul>`,
    )
    .join('')}${changelog}`;
}

/** A page's link in the contents, under its group or above them. */
function contentsLink(page: string, sub: boolean): string {
  const title = page === WHATS_NEW ? 'Changelog' : GUIDE_PAGES[page];
  return `    <a${sub ? ' class="nav-sub"' : ''} href="#" data-guide-page="${page}">${escapeHtml(title)}</a>\n`;
}

/**
 * The guide's contents down the side of Help, grouped and ordered as
 * docs/guide/README.md lists them, with the README itself first. On a
 * window too narrow for a side rail it sits above the page, folded behind
 * its Contents button.
 */
function renderContents(): string {
  return `  <nav aria-label="Guide pages">
    <span class="nav-title">Deckard Help</span>
    <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="help-nav-links">Contents</button>
    <div class="nav-links" id="help-nav-links">
${contentsLink('README', false)}${GUIDE_CONTENTS.map(
    ({ group, pages }) => `    <span class="nav-group">${escapeHtml(group)}</span>\n${pages.map((page) => contentsLink(page, true)).join('')}`,
  ).join('')}    </div>
  </nav>
`;
}

/** The place the page opens at, as the body's attributes the page script reads. */
function placeAttributes(place: HelpPlace | undefined): string {
  if (!place) {
    return '';
  }
  return ` data-page="${escapeHtml(place.page)}"${place.anchor ? ` data-anchor="${escapeHtml(place.anchor)}"` : ''}`;
}

/**
 * Builds Help: the guide's contents beside the page being read. A guide
 * page is rendered by the host when the page asks for it and shown in
 * place; What's new is drawn here, from the shipped changelog.
 */
export function getHelpHtml(webview: ShellWebview, extensionUri: ShellUri, options: HelpOptions): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'help',
    title: 'Deckard Help',
    nonce: createNonce(),
    theme: options.chrome.theme,
    zen: options.chrome.zen,
    display: options.chrome.display,
    csp: { images: [new URL(GUIDE_IMAGE_BASE).origin] },
    bodyAttributes: placeAttributes(options.place),
    // src/webview/help/main.ts: the contents, the guide's pages, and What's new.
    bundle: true,
    body: `
<main>
${renderContents()}  <article>
    <header>
      <p class="eyebrow"><button type="button" class="eyebrow-home" data-go-to="" aria-haspopup="menu" aria-expanded="false" aria-label="Deckard: go to another page">DECKARD ▾</button><span class="eyebrow-trail"> / HELP</span></p>
    </header>
    <div id="guide-view"></div>
    <section id="${WHATS_NEW}" hidden>
      <h1>Changelog</h1>
      ${renderWhatsNew(options.releases ?? [], options.newSince)}
    </section>
  </article>
</main>
`,
  });
}
