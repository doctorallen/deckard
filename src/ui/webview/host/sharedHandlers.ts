/**
 * The handlers for messages several pages send and act on alike. Each is a
 * factory: a page's controller calls it with what the handler needs and
 * puts the result in its handler map under the message's type.
 *
 * A handler is here only when the pages that send its message do exactly
 * the same with it today. Where two pages act on one message differently,
 * such as Stats merging tags through the Merge Tag command and a search
 * page merging them itself, each keeps its own handler, since moving a page
 * changes nothing a reader can see.
 */
import * as vscode from 'vscode';

import type { PreferenceServices } from '../../../core/storage/preferences';
import type { IndexControl, IndexReader } from '../../../core/workspace/indexReader';
import type { WorkspaceIndex } from '../../../domain/model';
import type { Task } from '../../../domain/model/tasks';
import type { NavigationService, SourcePolicy, TagPolicy } from '../../../services/navigationService';
import type { MessageHandler } from './pageController';
import type {
  ChooseThemeMessage,
  GoToPageMessage,
  ListGoToMessage,
  OpenGoToMessage,
  OpenHelpMessage,
  OpenSourceMessage,
  OpenTagMessage,
  ParkTagMessage,
  RenameTagMessage,
  SetDisplayMessage,
  SetZenModeMessage,
  SidebarReadyMessage,
  ToggleTaskMessage,
} from '../../protocol/shared';
import { openNoteAt } from '../../commands/noteOpening';
import { renameIndexedTag, TagWrites } from '../../commands/renameTag';
import { TaskWrites, toggleTask as writeTaskToggle } from '../../commands/taskActions';
import { setDisplayChoice } from '../displayChoices';
import { setZenMode as writeZenMode } from '../zenMode';
import { DECKARD_PAGE_COMMANDS, DeckardPageId, isDeckardPageId } from '../../state/deckardPages';
import { describeGoToMenu } from '../../views/pagesTree';

/** The gear's Choose Theme…, which runs the command. */
export function chooseTheme(): MessageHandler<ChooseThemeMessage> {
  return () => vscode.commands.executeCommand('deckard.chooseTheme');
}

/** The gear's Cards and Tags rows, written to the user's settings. */
export function setDisplay(): MessageHandler<SetDisplayMessage> {
  return (message) => setDisplayChoice(message.setting, message.value);
}

/** The gear's zen row, written where the setting is set. */
export function setZenMode(): MessageHandler<SetZenModeMessage> {
  return (message) => writeZenMode(message.enabled);
}

/**
 * DECKARD at the top of a page, asking for its menu: every page but the one
 * it is on, with the Pages view's hints, sent back to the page.
 */
export function listGoTo(options: {
  /** What the hints are read from; Help, drawn without one in tests, lists the pages bare. */
  indexer?: Pick<IndexReader, 'getSnapshot'>;
  /** The page asking, left out of its own menu. */
  current?: DeckardPageId;
}): MessageHandler<ListGoToMessage> {
  return (_message, page) => page.post(describeGoToMenu(options.indexer, options.current));
}

/** A page chosen from DECKARD's menu, opened by its command; an id that names no page does nothing. */
export function goToPage(): MessageHandler<GoToPageMessage> {
  return (message) =>
    isDeckardPageId(message.page) ? vscode.commands.executeCommand(DECKARD_PAGE_COMMANDS[message.page]) : undefined;
}

/** The menu's Go to…, or the key: the quick pick of every page. */
export function openGoTo(): MessageHandler<OpenGoToMessage> {
  return () => vscode.commands.executeCommand('deckard.goTo');
}

/**
 * The page's help button: Help, at a section when the page names one, as
 * the Calendar page names `periodic`.
 */
export function openHelp(section?: string): MessageHandler<OpenHelpMessage> {
  return () =>
    section === undefined
      ? vscode.commands.executeCommand('deckard.showHelp')
      : vscode.commands.executeCommand('deckard.showHelp', section);
}

/**
 * The page saying it has loaded, which is answered with its snapshot: a
 * page whose HTML the host reset after a theme change asks for its state
 * this way.
 */
export function ready(): MessageHandler<SidebarReadyMessage> {
  return (_message, page) => page.refresh();
}

/**
 * Rename Tag from a tag's menu: asked, previewed, and undoable, as from the
 * command. The page then opens the tag under its new name.
 */
export function renameTag(rename: {
  indexer: IndexReader & IndexControl;
  writes: TagWrites;
  /** Opens a tag's page, as the page opens tags. */
  openTag: (tagKey: string) => unknown;
}): MessageHandler<RenameTagMessage> {
  return async (message) => {
    const replacement = await renameIndexedTag(rename.indexer, message.tagKey, rename.writes);
    if (replacement) {
      await rename.openTag(replacement.key);
    }
  };
}

/** Park Tag or Unpark Tag from a tag's menu, by the command of that name. */
export function parkTag(): MessageHandler<ParkTagMessage> {
  return (message) => vscode.commands.executeCommand(`deckard.${message.type}`, message.tagKey);
}

/**
 * A task's checkbox. The task is looked up again first, where the page
 * finds it, so a box drawn for a task that has since gone writes nothing.
 */
export function toggleTask(toggle: {
  writes: TaskWrites;
  /** The task as the index has it now, or undefined. */
  findTask: (taskId: string) => Task | undefined;
}): MessageHandler<ToggleTaskMessage> {
  return async (message) => {
    const task = toggle.findTask(message.taskId);
    if (task) {
      await writeTaskToggle(toggle.writes, task, message.completed);
    }
  };
}

/** What an open from a page is checked against, and by which rule. */
interface NavigationRule<TPolicy> {
  indexer: { getSnapshot(): WorkspaceIndex };
  navigation: NavigationService;
  policy: TPolicy;
}

/**
 * A row's line, opened as a result opens: in the editor or on the note
 * page, as `deckard.openNotesIn` and Shift say, previewed, kept, or beside
 * the page, as the click asked. The line opens only when the page's policy
 * accepts it in the index as it is now, and an entry's visit is counted
 * after it opens, under the policies that count one.
 */
export function openSource(open: NavigationRule<SourcePolicy> & {
  /** Where a visit is counted; a policy that counts none needs none. */
  usage?: Pick<PreferenceServices['usage'], 'recordSectionAccess'>;
}): MessageHandler<OpenSourceMessage> {
  return async (message) => {
    const index = open.indexer.getSnapshot();
    const location = open.navigation.resolveSourceLocation(index, message.filePath, message.line, open.policy);
    if (location.kind === 'unknown') {
      return;
    }
    await openNoteAt(location.filePath, location.line, message);
    if (location.visit) {
      await open.usage?.recordSectionAccess(location.visit);
    }
  };
}

/**
 * A tag's page, for a tag the index still has, found by the page's policy.
 * The page may hold a snapshot from before the tag was renamed.
 */
export function openTag(open: NavigationRule<TagPolicy> & {
  /** Opens a tag's page, by its key in the index. */
  openTag: (tagKey: string) => unknown;
}): MessageHandler<OpenTagMessage> {
  return async (message) => {
    const tag = open.navigation.resolveTag(open.indexer.getSnapshot(), message.tagKey, open.policy);
    if (tag.kind === 'open') {
      await open.openTag(tag.tagKey);
    }
  };
}
