import * as vscode from 'vscode';

import { escapeHtml } from '../../../../shared/html';
import { GUIDE_PAGES } from '../../guide';
import { rewriteGuideHtml } from './guideLinks';

/**
 * The command of VS Code's built-in Markdown extension that renders
 * Markdown with the engine every preview uses (decision 0012). It is
 * internal: the extension registers it without contributing it, so it is
 * not listed by `getCommands`, and it is gone while a reader has disabled
 * that extension.
 */
const RENDER_COMMAND = 'markdown.api.render';

/** The guide's site, built from docs/guide; its front page is the guide's README. */
const GUIDE_SITE = 'https://deckard.esperinnovations.com';

/**
 * A guide page as the Help panel shows it, rendered by VS Code's Markdown
 * engine: headings carry the anchors GitHub gives them, links between pages
 * stay in the panel, and screenshots load from GitHub, since the VSIX leaves
 * them out to stay small. It fails when the Markdown extension cannot
 * render it, such as while the reader has disabled it.
 */
export async function renderGuidePage(source: string): Promise<string> {
  const html: unknown = await vscode.commands.executeCommand(RENDER_COMMAND, source);
  if (typeof html !== 'string') {
    throw new Error(`${RENDER_COMMAND} returned no HTML.`);
  }
  return rewriteGuideHtml(html);
}

/**
 * Starts the Markdown extension, which takes about half a second the first
 * time, so the first guide page Help shows does not wait on it. Nothing is
 * said if it cannot start: the page asked for says so then.
 */
export function warmGuideRenderer(): void {
  void (async () => {
    try {
      await vscode.commands.executeCommand(RENDER_COMMAND, '');
    } catch {
      // The page asked for says the extension is not available.
    }
  })();
}

/** A guide page's address on the guide's site. */
export function guideSiteAddress(page: string): string {
  return page === 'README' ? GUIDE_SITE : `${GUIDE_SITE}/${page}.html`;
}

/**
 * What Help shows in place of a guide page when VS Code's Markdown
 * extension cannot render it: one sentence, with the page on the site.
 */
export function guideUnavailableHtml(page: string): string {
  return `<p>Help shows the guide with VS Code’s built-in Markdown extension, which is not available, so this page is on the guide’s site: <a href="${guideSiteAddress(page)}">${escapeHtml(GUIDE_PAGES[page] ?? page)}</a>.</p>`;
}
