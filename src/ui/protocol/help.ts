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

/** Help's tabs (plan 48): the page Help was asked from, the Tour, and the guide. */
export type HelpTab = 'page' | 'tour' | 'guide';

/** A tab of Help shown, which asks the host for This page's or the Tour's content. */
export interface HelpTabMessage {
  type: 'helpTab';
  tab: HelpTab;
}

/** What This page's and the Tour's controls ask of the host. */
export type HelpAction =
  | 'select'
  | 'back'
  | 'explore'
  | 'show-me'
  | 'choose'
  | 'open-setting'
  | 'edit-statuses'
  | 'open-board'
  | 'tour-go'
  | 'tour-next'
  | 'tour-previous'
  | 'tour-again'
  | 'tour-do'
  | 'tour-tick'
  | 'tour-end'
  | 'tour-present'
  | 'tour-stop'
  | 'tour-reset'
  | 'tour-demo'
  | 'tour-hide-help'
  | 'tour-create-sample';

/**
 * A control of This page or the Tour: what it asks, and what it names, an
 * entry or a scene by id, a scene by number, a choice and its value, a
 * setting by key, or a box's state.
 */
export interface HelpActionMessage {
  type: 'helpAction';
  action: HelpAction;
  id?: string;
  index?: number;
  on?: boolean;
  choice?: string;
  value?: string;
  key?: string;
}

/**
 * A setting changed on This page: its key, without `deckard.`, and what was
 * entered, which the host checks against the setting's schema before it
 * writes. A flag of an object of booleans is `{ name, on }`.
 */
export interface HelpSettingMessage {
  type: 'helpSetting';
  key: string;
  value: unknown;
}

/** What the Help page sends its host, by type. */
export interface HelpPageToHost {
  runCommand: HelpRunCommandMessage;
  openChangelog: OpenChangelogMessage;
  openGuide: OpenGuideMessage;
  openGoTo: OpenGoToMessage;
  listGoTo: ListGoToMessage;
  goToPage: GoToPageMessage;
  helpTab: HelpTabMessage;
  helpAction: HelpActionMessage;
  helpSetting: HelpSettingMessage;
}

/**
 * Help, already open, asked to show a place: a guide page by its file name,
 * or `whats-new`, at a heading when one is named.
 */
export interface HelpRevealMessage {
  type: 'reveal';
  page: string;
  anchor?: string;
  /** The tab to show; the guide's when none is named. */
  tab?: HelpTab;
}

/** This page's or the Tour's content, drawn by the host, for its tab. */
export interface HelpPanelMessage {
  type: 'helpPanel';
  tab: Exclude<HelpTab, 'guide'>;
  html: string;
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
  helpPanel: HelpPanelMessage;
}

/** What the Help page may ask of its host. */
export type HelpMessage = MessageOf<HelpPageToHost>;
