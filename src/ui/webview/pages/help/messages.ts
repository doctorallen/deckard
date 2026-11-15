/**
 * The Help page's narrowing table: what each message it may send must
 * hold. Only the shape is checked here; the host runs a command only when
 * Help is allowed to run it, and opens a guide page only when the guide
 * has it.
 */
import type { HelpAction, HelpActionMessage, HelpPageToHost, HelpRunCommandMessage, HelpSettingMessage, HelpTabMessage, OpenGuideMessage } from '../../../protocol/help';
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

/** A tab by name. */
const narrowHelpTab: Narrower<HelpTabMessage> = (value) =>
  value.tab === 'page' || value.tab === 'tour' || value.tab === 'guide' ? { type: 'helpTab', tab: value.tab } : undefined;

const HELP_ACTIONS: readonly HelpAction[] = [
  'select', 'back', 'explore', 'show-me', 'choose', 'open-setting', 'edit-statuses', 'open-board',
  'tour-go', 'tour-next', 'tour-previous', 'tour-again', 'tour-do', 'tour-tick', 'tour-end',
  'tour-present', 'tour-stop', 'tour-reset', 'tour-hide-help', 'tour-create-sample',
];

/** A short word, as an entry's, a scene's, a choice's, or a value's name may be. */
function word(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w.#/-]{1,80}$/.test(value) ? value : undefined;
}

/** A control of This page or the Tour, and what it names. */
const narrowHelpAction: Narrower<HelpActionMessage> = (value) => {
  const action = HELP_ACTIONS.find((known) => known === value.action);
  if (!action) {
    return undefined;
  }
  const id = word(value.id);
  const choice = word(value.choice);
  const named = word(value.value);
  const key = word(value.key);
  return {
    type: 'helpAction',
    action,
    ...(id ? { id } : {}),
    ...(typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0 && value.index < 100 ? { index: value.index } : {}),
    ...(typeof value.on === 'boolean' ? { on: value.on } : {}),
    ...(choice ? { choice } : {}),
    ...(named ? { value: named } : {}),
    ...(key ? { key } : {}),
  };
};

/** A setting's key and what was entered; the host checks the value against the setting's schema. */
const narrowHelpSetting: Narrower<HelpSettingMessage> = (value) => {
  const key = word(value.key);
  if (!key) {
    return undefined;
  }
  const sent = value.value;
  const fits =
    typeof sent === 'boolean' ||
    typeof sent === 'number' ||
    (typeof sent === 'string' && sent.length <= 200) ||
    (sent !== null && typeof sent === 'object' && typeof (sent as { name?: unknown }).name === 'string' && typeof (sent as { on?: unknown }).on === 'boolean');
  return fits ? { type: 'helpSetting', key, value: sent } : undefined;
};

/** Each message the Help page may send, and what it must hold. */
export const HELP_MESSAGES: NarrowingTable<HelpPageToHost> = {
  runCommand: narrowRunCommand,
  openChangelog: onlyType('openChangelog'),
  openGuide: narrowOpenGuide,
  openGoTo: exactlyType('openGoTo'),
  listGoTo: exactlyType('listGoTo'),
  goToPage: narrowGoToPage,
  helpTab: narrowHelpTab,
  helpAction: narrowHelpAction,
  helpSetting: narrowHelpSetting,
};

/** A message from the Help page, narrowed by its table, or undefined. */
export const narrowHelpMessage = narrowWith(HELP_MESSAGES);
