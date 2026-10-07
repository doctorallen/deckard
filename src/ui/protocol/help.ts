/**
 * The Help page's protocol: the commands, guide pages, and changelog it
 * asks for, and what the host sends back. Help's contents and What's new
 * are drawn by the host in its HTML, so it is sent no snapshot.
 */
import type { MessageOf } from './messaging';
import type { GoToPageMessage, ListGoToMessage, OpenGoToMessage } from './shared';

/**
 * A command Help names, run from its button. Only the shape is the page's
 * to send; the host runs it only when Help is allowed to.
 */
export interface HelpRunCommandMessage {
  type: 'runCommand';
  command: string;
}

/** What's new's link to the whole changelog. */
export interface OpenChangelogMessage {
  type: 'openChangelog';
}

/** A guide page by its file name, at a heading when one is named. */
export interface OpenGuideMessage {
  type: 'openGuide';
  page: string;
  anchor?: string;
}

/** What the Help page sends its host, by type. */
export interface HelpPageToHost {
  runCommand: HelpRunCommandMessage;
  openChangelog: OpenChangelogMessage;
  openGuide: OpenGuideMessage;
  openGoTo: OpenGoToMessage;
  listGoTo: ListGoToMessage;
  goToPage: GoToPageMessage;
}

/**
 * Help, already open, asked to show a place: a guide page by its file name,
 * or `whats-new`, at a heading when one is named.
 */
export interface HelpRevealMessage {
  type: 'reveal';
  page: string;
  anchor?: string;
}

/**
 * A guide page, rendered from the copy the VSIX ships, to show in Help, at
 * a heading when one was asked for, its command names made buttons. A page that cannot be read is
 * one sentence saying so, with a link to it on GitHub; one VS Code's
 * Markdown extension cannot render is one sentence saying so, with a link
 * to it on the guide's site.
 */
export interface HelpGuideMessage {
  type: 'guide';
  page: string;
  title: string;
  html: string;
  anchor?: string;
}

/** What the host sends the Help page, by type. */
export interface HelpHostToPage {
  reveal: HelpRevealMessage;
  guide: HelpGuideMessage;
}

/** What the Help page may ask of its host. */
export type HelpMessage = MessageOf<HelpPageToHost>;
