import * as vscode from 'vscode';

import type { PreferencesRepository } from '../../core/storage/preferencesRepository';
import type { IndexReader } from '../../core/workspace/indexReader';
import { formatIsoDate } from '../../domain/markdown/calendar';
import type { PersistedPreferences, WorkspaceIndex } from '../../domain/model';
import {
  countKnownStatusTags,
  countStatusMove,
  importObsidianStatuses,
  listKeptStatusTags,
  moveLegacyColumnOrder,
  moveLegacyLimits,
  moveStatusTagsInQuery,
  planStatusMove,
  type StatusMoveGroup,
  type StatusMoveLine,
} from '../../domain/tasks/statusMigration';
import { type LegacyStatusTags, nameStatusTag, readLegacyStatusTags } from '../../domain/tasks/legacyStatusTags';
import type { TaskStatusDefinition } from '../../domain/tasks/taskStatuses';
import { pluralize } from '../../shared/text';
import { resolveSourceUri } from './navigation';
import { readTaskStatusOptions } from './parseSettings';
import { findQueryBlockEdits } from './queryBlockEdits';
import { writeSetting } from './settings';
import { readNotesFolder } from './writeTarget';
import type { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * Moving status tags into checkboxes, and importing a vault's statuses from
 * Obsidian Tasks: two commands; the first scan's offer of the import, made
 * once per workspace; the notice, made each session while a task line
 * still carries a status tag the move knows; and the old board settings,
 * moved once.
 */

/** The workspace-state key that records the import was offered. */
export const STATUS_IMPORT_OFFERED = 'deckard.statusImportOffered';
/** The workspace-state key that records the old board settings were moved into the gear's choices. */
export const STATUS_SETTINGS_MOVED = 'deckard.statusSettingsMoved';

/** Where Obsidian Tasks keeps its settings in a vault. */
const OBSIDIAN_TASKS_SETTINGS = ['.obsidian', 'plugins', 'obsidian-tasks-plugin', 'data.json'];

/** What each group of the move, and the searches it carries, are called in the preview. */
const GROUP_LABELS: Readonly<Record<Exclude<StatusMoveGroup, 'kept'> | 'search', { label: string; description: string }>> = {
  character: { label: 'Tag becomes the character', description: 'The status tag is written as the box: - [/] in place of #status/doing.' },
  stale: { label: 'Stale tag removed', description: 'The box already says the status, so the tag goes.' },
  done: { label: 'Tagged done on an open box: checked off', description: 'The box is checked, with its done date, and the tag goes.' },
  search: { label: 'Search by status', description: 'A query block that named a status tag searches by the status: status:in-progress in place of #status/doing.' },
};

/** The statuses as the settings list them now, and what the status tags meant. */
function readStatusReading(): { statuses: readonly TaskStatusDefinition[]; legacy: LegacyStatusTags } {
  const configuration = vscode.workspace.getConfiguration('deckard');
  return {
    statuses: readTaskStatusOptions(),
    legacy: readLegacyStatusTags(configuration.get<unknown>('board.statusNamespace'), configuration.get<unknown>('tasks.statuses')),
  };
}

/** What the move is about to do, from the index as it is now. */
function planFromIndex(index: WorkspaceIndex, doneDate: string | undefined): { lines: StatusMoveLine[]; statuses: readonly TaskStatusDefinition[]; legacy: LegacyStatusTags } {
  const { statuses, legacy } = readStatusReading();
  const lines = planStatusMove(index.tasks.values(), { statuses, legacy, ...(doneDate ? { doneDate } : {}) });
  return { lines, statuses, legacy };
}

/** Each index's count of the task lines with a status tag the move knows, by what the tags meant. */
const statusTagCounts = new WeakMap<WorkspaceIndex, { key: string; count: number }>();

/**
 * How many task lines still carry a status tag the move knows, which the
 * notice, the board's strip, and the Tasks view's message count, and the
 * namespace they are written in. Worked out once per index.
 */
export function countStatusTagsLeft(index: WorkspaceIndex): { count: number; namespace: string } {
  const { statuses, legacy } = readStatusReading();
  const key = JSON.stringify([legacy.namespace, [...legacy.characters], statuses.map((status) => status.symbol)]);
  let cached = statusTagCounts.get(index);
  if (cached?.key !== key) {
    cached = { key, count: countKnownStatusTags(planStatusMove(index.tasks.values(), { statuses, legacy })) };
    statusTagCounts.set(index, cached);
  }
  return { count: cached.count, namespace: legacy.namespace };
}

/** What the board's strip and the Tasks view say while status tags are left: "23 tasks still have #status tags." */
export function describeStatusTagsLeft(left: { count: number; namespace: string }): string {
  return `${pluralize(left.count, 'task still has a', 'tasks still have')} #${left.namespace} ${left.count === 1 ? 'tag' : 'tags'}.`;
}

/** The searches the move carries with it: saved searches and Home's widgets that name a status tag. */
type SearchPreferences = Pick<PreferencesRepository, 'current' | 'update'>;

/**
 * Deckard: Move Status Tags into Checkboxes…: every task whose status tag
 * stood for a status the list has a character for gets that character in
 * its box, a tag its box already says goes, and the query blocks that
 * name such a tag search by its status, shown first in the refactor
 * preview in groups, written as one change Undo takes back. Open tasks
 * tagged done are checked off only when asked. Saved searches and Home's
 * widgets follow, when the reader says so. A tag no status has a character
 * for stays, and Give It a Character makes it a status.
 */
export async function moveStatusTagsCommand(
  indexer: Pick<IndexReader, 'getSnapshot'>,
  history: WorkspaceWriteHistory,
  preferences?: SearchPreferences,
): Promise<void> {
  const addDoneDate = vscode.workspace.getConfiguration('deckard').get<boolean>('tasks.addDoneDate', true);
  const index = indexer.getSnapshot();
  const { lines, statuses, legacy } = planFromIndex(index, addDoneDate ? formatIsoDate(Date.now()) : undefined);
  const rewrite = (query: string): string => moveStatusTagsInQuery(query, legacy, statuses);
  const counts = countStatusMove(lines);
  const blocks = await findQueryBlockEdits(index.files.values(), rewrite, new RegExp(`${legacy.namespace}/`, 'i'));
  const searches = preferences ? rewriteSearches(preferences.current, rewrite) : undefined;
  if (counts.character + counts.stale + counts.done + blocks.lines === 0) {
    if (searches) {
      await offerSearches(preferences as SearchPreferences, searches);
    }
    await offerCharacters(lines, legacy, counts.kept
      ? `No status tag has a character to move into. ${describeKept(counts.kept)}`
      : `No task has a #${legacy.namespace} tag to move into its box.`);
    return;
  }
  let moved = lines.filter((line) => line.group === 'character' || line.group === 'stale');
  if (counts.done > 0) {
    const checkOff = await vscode.window.showQuickPick(
      [
        { label: 'Leave Them Open', description: 'Their tag stays', check: false },
        { label: 'Check Them Off', description: 'Done, with the done date', check: true },
      ],
      { title: `${pluralize(counts.done, 'open task is', 'open tasks are')} tagged done`, placeHolder: 'Check them off as well?' },
    );
    if (!checkOff) {
      return;
    }
    if (checkOff.check) {
      moved = [...moved, ...lines.filter((line) => line.group === 'done')];
    }
  }
  const { edit, groups } = await buildMoveEdit(moved, blocks.edit);
  blocks.places.forEach((place) => groups.set(place, 'search'));
  const written = await history.write(edit, {
    label: 'Move Status Tags into Checkboxes',
    preview: 'always',
    groupOf: (uri, at) => {
      const group = groups.get(`${uri.toString()}:${at}`);
      return group && group !== 'kept' ? GROUP_LABELS[group] : undefined;
    },
  });
  if (!written.applied) {
    return;
  }
  if (searches) {
    await offerSearches(preferences as SearchPreferences, searches);
  }
  const said = moved.length ? `Moved ${pluralize(moved.length, 'status', 'statuses')} into ${moved.length === 1 ? 'its box' : 'their boxes'}.` : 'Moved the searches.';
  await offerCharacters(lines, legacy, `${said}${counts.kept ? ` ${describeKept(counts.kept)}` : ''}`);
}

/**
 * Says what the move did, and, when it left tags no status has a character
 * for, offers Give It a Character: Edit Task Statuses on a new row named
 * for the tag, the one most carried, or the one chosen of several.
 */
async function offerCharacters(lines: readonly StatusMoveLine[], legacy: LegacyStatusTags, said: string): Promise<void> {
  const kept = listKeptStatusTags(lines);
  const chosen = await vscode.window.showInformationMessage(said, ...(kept.length ? ['Give It a Character'] : []));
  if (!chosen) {
    return;
  }
  const picked = kept.length === 1
    ? kept[0]
    : await vscode.window.showQuickPick(
      kept.map((entry) => ({ label: `#${legacy.namespace}/${entry.tag}`, description: pluralize(entry.count, 'task'), ...entry })),
      { title: 'Give which tag a character?', placeHolder: 'Edit Task Statuses opens on a new status of its name' },
    );
  if (picked) {
    await vscode.commands.executeCommand('deckard.editTaskStatuses', {
      newStatus: { name: nameStatusTag(picked.tag), type: legacy.types.get(picked.tag) ?? 'todo' },
    });
  }
}

/** Saved searches and Home's widgets with each status tag the move knows written as its status, and how many changed; undefined when none did. */
function rewriteSearches(
  current: PersistedPreferences,
  rewrite: (query: string) => string,
): Pick<PersistedPreferences, 'dashboardWidgets' | 'savedFilters'> & { changed: number } | undefined {
  const dashboardWidgets = current.dashboardWidgets.map((widget) => (widget.query ? { ...widget, query: rewrite(widget.query) } : widget));
  const savedFilters = current.savedFilters.map((filter) => (filter.query ? { ...filter, query: rewrite(filter.query) } : filter));
  const changed =
    dashboardWidgets.filter((widget, at) => widget.query !== current.dashboardWidgets[at].query).length +
    savedFilters.filter((filter, at) => filter.query !== current.savedFilters[at].query).length;
  return changed ? { dashboardWidgets, savedFilters, changed } : undefined;
}

/** Asks to search the saved searches and Home's widgets that name a status tag by the status, and does when told. */
async function offerSearches(
  preferences: SearchPreferences,
  searches: Pick<PersistedPreferences, 'dashboardWidgets' | 'savedFilters'> & { changed: number },
): Promise<void> {
  const chosen = await vscode.window.showInformationMessage(
    `${pluralize(searches.changed, 'saved search names', 'saved searches name')} a status tag. Search by the status instead, as status:in-progress?`,
    'Update Them',
  );
  if (chosen === 'Update Them') {
    await preferences.update({ dashboardWidgets: searches.dashboardWidgets, savedFilters: searches.savedFilters });
  }
}

/**
 * The move as edits to `edit`, each line checked against its note as it
 * is now, a line changed since left out; and each change's group, by its
 * note and line, for the preview.
 */
async function buildMoveEdit(moved: readonly StatusMoveLine[], edit: vscode.WorkspaceEdit): Promise<{ edit: vscode.WorkspaceEdit; groups: Map<string, StatusMoveGroup | 'search'> }> {
  const groups = new Map<string, StatusMoveGroup | 'search'>();
  for (const line of moved) {
    const uri = await resolveSourceUri(line.filePath);
    if (!uri) {
      continue;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const at = line.lineNumber - 1;
    if (at >= document.lineCount || document.lineAt(at).text !== line.before) {
      continue;
    }
    edit.replace(uri, document.lineAt(at).range, line.after);
    groups.set(`${uri.toString()}:${at}`, line.group);
  }
  return { edit, groups };
}

/** What the move left as tags, and why. */
function describeKept(kept: number): string {
  return `${pluralize(kept, 'task keeps its tag', 'tasks keep their tags')}: no status has a character for ${kept === 1 ? 'it' : 'them'} yet.`;
}

/** The first `data.json` Obsidian Tasks keeps in a workspace folder or its notes folder, read. */
async function readObsidianTasksSettings(): Promise<unknown> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const notes = readNotesFolder(folder);
    const roots = [folder.uri, ...(notes ? [vscode.Uri.joinPath(folder.uri, ...notes.split('/'))] : [])];
    for (const root of roots) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...OBSIDIAN_TASKS_SETTINGS));
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

/**
 * Deckard: Import Statuses from Obsidian Tasks: a vault's core and custom
 * statuses, read from Obsidian Tasks' settings, written to this
 * workspace's `deckard.tasks.statuses`, since they are the vault's.
 */
export async function importObsidianStatusesCommand(): Promise<boolean> {
  const statuses = importObsidianStatuses(await readObsidianTasksSettings());
  if (!statuses) {
    void vscode.window.showInformationMessage(
      'Deckard found no statuses to import: Obsidian Tasks keeps them in .obsidian/plugins/obsidian-tasks-plugin/data.json in the vault.',
    );
    return false;
  }
  const names = statuses.map((status) => `[${status.symbol}] ${status.name}`).join(', ');
  const chosen = await vscode.window.showInformationMessage(
    `Import ${pluralize(statuses.length, 'status', 'statuses')} from Obsidian Tasks into this workspace's settings? ${names}.`,
    { modal: true },
    'Import',
  );
  if (chosen !== 'Import') {
    return false;
  }
  await writeSetting('tasks.statuses', statuses, vscode.ConfigurationTarget.Workspace);
  return true;
}

/** How the offers ask, and where the gear's choices are kept; the defaults are VS Code's. */
export interface StatusOfferOptions {
  show?: (message: string, ...buttons: string[]) => Thenable<string | undefined>;
  run?: (command: string) => Thenable<unknown>;
  hasObsidianStatuses?: () => Promise<boolean>;
  /** The board's column choices, which the old board settings move into. */
  board?: BoardChoices;
}

/** The gear's column choices: what is kept, and how each is set. */
export interface BoardChoices {
  readonly reader: { readonly value: Pick<PersistedPreferences, 'taskBoardColumnOrder' | 'taskBoardHiddenColumns'> };
  readonly taskLayout: {
    setTaskBoardColumnOrder(names: readonly string[]): Promise<void>;
    setTaskBoardHiddenColumns(names: readonly string[]): Promise<void>;
  };
}

/**
 * The old board settings, moved once per workspace into what the gear now
 * keeps: `deckard.board.statuses`' order as the columns' order, by the
 * statuses its tags meant; `deckard.board.showCancelled` as Cancelled
 * shown; and the keys of `deckard.board.limits` that name an old tag as
 * the status's slug, where the reader set them. A choice the gear has made
 * already is kept. The old settings are then ignored.
 */
export async function moveBoardSettingsOnce(workspaceState: vscode.Memento, board: BoardChoices): Promise<void> {
  if (workspaceState.get<boolean>(STATUS_SETTINGS_MOVED) === true) {
    return;
  }
  await workspaceState.update(STATUS_SETTINGS_MOVED, true);
  const configuration = vscode.workspace.getConfiguration('deckard');
  const { statuses, legacy } = readStatusReading();
  const order = moveLegacyColumnOrder(configuration.get<unknown>('board.statuses'), legacy, statuses);
  if (order?.length && board.reader.value.taskBoardColumnOrder === undefined) {
    await board.taskLayout.setTaskBoardColumnOrder(order);
  }
  if (configuration.get<unknown>('board.showCancelled') === true && board.reader.value.taskBoardHiddenColumns === undefined) {
    await board.taskLayout.setTaskBoardHiddenColumns([]);
  }
  const limits = configuration.inspect<unknown>('board.limits');
  for (const [value, target] of [
    [limits?.globalValue, vscode.ConfigurationTarget.Global],
    [limits?.workspaceValue, vscode.ConfigurationTarget.Workspace],
  ] as const) {
    const moved = moveLegacyLimits(value, legacy, statuses);
    if (moved) {
      await writeSetting('board.limits', moved, target, configuration);
    }
  }
}

/**
 * The first scan's offers: the old board settings moved, once per
 * workspace; then, once per workspace, to import a vault's statuses where
 * Obsidian Tasks keeps some and the workspace names none of its own;
 * otherwise, each session while any task line carries a status tag the
 * move knows, the notice that offers to preview the move.
 */
export async function offerStatusMigrationOnce(
  workspaceState: vscode.Memento,
  indexer: Pick<IndexReader, 'getSnapshot'>,
  options: StatusOfferOptions = {},
): Promise<void> {
  const show = options.show ?? ((message, ...buttons) => vscode.window.showInformationMessage(message, ...buttons));
  const run = options.run ?? ((command) => vscode.commands.executeCommand(command));
  const hasObsidian = options.hasObsidianStatuses ?? (async () => importObsidianStatuses(await readObsidianTasksSettings()) !== undefined);
  if (options.board) {
    await moveBoardSettingsOnce(workspaceState, options.board);
  }
  const named = vscode.workspace.getConfiguration('deckard').inspect('tasks.statuses')?.workspaceValue !== undefined;
  if (!named && workspaceState.get<boolean>(STATUS_IMPORT_OFFERED) !== true && (await hasObsidian())) {
    await workspaceState.update(STATUS_IMPORT_OFFERED, true);
    if ((await show('This workspace is an Obsidian vault with task statuses of its own. Import them, so Deckard reads each character as Obsidian Tasks does?', 'Import Statuses')) === 'Import Statuses') {
      await run('deckard.importObsidianStatuses');
    }
    return;
  }
  const left = countStatusTagsLeft(indexer.getSnapshot());
  if (left.count === 0) {
    return;
  }
  const chosen = await show(
    `${pluralize(left.count, 'task keeps its status in a', 'tasks keep their status in a')} #${left.namespace} tag, which Deckard no longer reads.`,
    'Preview the Move',
    'Later',
  );
  if (chosen === 'Preview the Move') {
    await run('deckard.moveStatusTagsIntoCheckboxes');
  }
}
