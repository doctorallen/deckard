/**
 * The Help page's narrowing table: what each message it may send must
 * hold. Only the shape is checked here; the host runs a command only when
 * Help is allowed to run it, and opens a guide page only when the guide
 * has it.
 */
import type { HelpPageToHost, HelpRunCommandMessage, OpenGuideMessage } from '../../../protocol/help';
import { exactlyType, narrowGoToPage, Narrower, NarrowingTable, narrowWith, onlyType } from '../../host/narrowing';

/** A command of Deckard's, by its id. */
const narrowRunCommand: Narrower<HelpRunCommandMessage> = (value) =>
  typeof value.command === 'string' && /^deckard\.[\w.]+$/.test(value.command)
    ? { type: 'runCommand', command: value.command }
    : undefined;

/** A page's file name and a heading's anchor: nothing that climbs out. */
const narrowOpenGuide: Narrower<OpenGuideMessage> = (value) =>
  typeof value.page === 'string' && /^[\w-]+$/.test(value.page) &&
  (value.anchor === undefined || (typeof value.anchor === 'string' && /^[\w-]+$/.test(value.anchor)))
    ? { type: 'openGuide', page: value.page, ...(typeof value.anchor === 'string' ? { anchor: value.anchor } : {}) }
    : undefined;

/** Each message the Help page may send, and what it must hold. */
export const HELP_MESSAGES: NarrowingTable<HelpPageToHost> = {
  runCommand: narrowRunCommand,
  openChangelog: onlyType('openChangelog'),
  openGuide: narrowOpenGuide,
  openGoTo: exactlyType('openGoTo'),
  listGoTo: exactlyType('listGoTo'),
  goToPage: narrowGoToPage,
};

/** A message from the Help page, narrowed by its table, or undefined. */
export const narrowHelpMessage = narrowWith(HELP_MESSAGES);
