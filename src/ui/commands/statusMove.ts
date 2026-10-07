import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { formatIsoDate } from '../../domain/markdown/calendar';
import { countStatusMove, importObsidianStatuses, planStatusMove, type StatusMoveGroup, type StatusMoveLine } from '../../domain/tasks/statusMigration';
import { readLegacyStatusTags } from '../../domain/tasks/legacyStatusTags';
import type { TaskStatusDefinition } from '../../domain/tasks/taskStatuses';
import { pluralize } from '../../shared/text';
import { resolveSourceUri } from './navigation';
import { readTaskStatusOptions } from './parseSettings';
import { writeSetting } from './settings';
import { readNotesFolder } from './writeTarget';
import type { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * Moving status tags into checkboxes, and importing a vault's statuses from
 * Obsidian Tasks: two commands, and the first scan's offer of each, made
 * once per workspace.
 */

/** The workspace-state key that records the move was offered. */
export const STATUS_MOVE_OFFERED = 'deckard.statusMoveOffered';
/** The workspace-state key that records the import was offered. */
export const STATUS_IMPORT_OFFERED = 'deckard.statusImportOffered';

/** Where Obsidian Tasks keeps its settings in a vault. */
const OBSIDIAN_TASKS_SETTINGS = ['.obsidian', 'plugins', 'obsidian-tasks-plugin', 'data.json'];

/** What each group of the move is called in the preview. */
const GROUP_LABELS: Readonly<Record<Exclude<StatusMoveGroup, 'kept'>, { label: string; description: string }>> = {
  character: { label: 'Tag becomes the character', description: 'The status tag is written as the box: - [/] in place of #status/doing.' },
  stale: { label: 'Stale tag removed', description: 'The box already says the status, so the tag that says otherwise goes.' },
  done: { label: 'Tagged done on an open box: checked off', description: 'The box is checked, with its done date, and the tag goes.' },
};

/** What the move is about to do, from the index as it is now. */
function planFromIndex(indexer: Pick<IndexReader, 'getSnapshot'>, doneDate: string | undefined): { lines: StatusMoveLine[]; statuses: readonly TaskStatusDefinition[] } {
  const statuses = readTaskStatusOptions();
  const configuration = vscode.workspace.getConfiguration('deckard');
  const legacy = readLegacyStatusTags(configuration.get<unknown>('board.statusNamespace'), configuration.get<unknown>('tasks.statuses'));
  const lines = planStatusMove(indexer.getSnapshot().tasks.values(), { statuses, legacy, ...(doneDate ? { doneDate } : {}) });
  return { lines, statuses };
}

/**
 * Deckard: Move Status Tags into Checkboxes…: every task whose status tag
 * names a status with a character gets that character in its box, and a
 * tag its box already contradicts goes, shown first in the refactor preview
 * in groups, written as one change Undo takes back. Open tasks tagged done
 * are checked off only when asked. Tags no character stands for stay.
 */
export async function moveStatusTagsCommand(
  indexer: Pick<IndexReader, 'getSnapshot'>,
  history: WorkspaceWriteHistory,
): Promise<void> {
  const addDoneDate = vscode.workspace.getConfiguration('deckard').get<boolean>('tasks.addDoneDate', true);
  const { lines } = planFromIndex(indexer, addDoneDate ? formatIsoDate(Date.now()) : undefined);
  const counts = countStatusMove(lines);
  if (counts.character + counts.stale + counts.done === 0) {
    void vscode.window.showInformationMessage(
      counts.kept
        ? `No status tag has a character to move into. ${describeKept(counts.kept)}`
        : 'No task has a status tag to move into its box.',
    );
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
  const { edit, groups } = await buildMoveEdit(moved);
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
  const said = `Moved ${pluralize(moved.length, 'status', 'statuses')} into ${moved.length === 1 ? 'its box' : 'their boxes'}.`;
  const kept = counts.kept ? ` ${describeKept(counts.kept)}` : '';
  const chosen = await vscode.window.showInformationMessage(`${said}${kept}`, ...(counts.kept ? ['Give It a Character'] : []));
  if (chosen) {
    await vscode.commands.executeCommand('deckard.editTaskStatuses');
  }
}

/**
 * The move as one workspace edit, each line checked against its note as it
 * is now, a line changed since left out; and each change's group, by its
 * note and line, for the preview.
 */
async function buildMoveEdit(moved: readonly StatusMoveLine[]): Promise<{ edit: vscode.WorkspaceEdit; groups: Map<string, StatusMoveGroup> }> {
  const edit = new vscode.WorkspaceEdit();
  const groups = new Map<string, StatusMoveGroup>();
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
  const names = statuses.map((status) => (status.symbol === undefined ? status.name : `[${status.symbol}] ${status.name}`)).join(', ');
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

/** How the offers ask; the default is VS Code's. */
export interface StatusOfferOptions {
  show?: (message: string, ...buttons: string[]) => Thenable<string | undefined>;
  run?: (command: string) => Thenable<unknown>;
  hasObsidianStatuses?: () => Promise<boolean>;
}

/**
 * The first scan's offers, each made once per workspace: to import a
 * vault's statuses where Obsidian Tasks keeps some and the workspace names
 * none of its own; otherwise to move status tags into checkboxes where any
 * task's tag has a character to move into.
 */
export async function offerStatusMigrationOnce(
  workspaceState: vscode.Memento,
  indexer: Pick<IndexReader, 'getSnapshot'>,
  options: StatusOfferOptions = {},
): Promise<void> {
  const show = options.show ?? ((message, ...buttons) => vscode.window.showInformationMessage(message, ...buttons));
  const run = options.run ?? ((command) => vscode.commands.executeCommand(command));
  const hasObsidian = options.hasObsidianStatuses ?? (async () => importObsidianStatuses(await readObsidianTasksSettings()) !== undefined);
  const named = vscode.workspace.getConfiguration('deckard').inspect('tasks.statuses')?.workspaceValue !== undefined;
  if (!named && workspaceState.get<boolean>(STATUS_IMPORT_OFFERED) !== true && (await hasObsidian())) {
    await workspaceState.update(STATUS_IMPORT_OFFERED, true);
    if ((await show('This workspace is an Obsidian vault with task statuses of its own. Import them, so Deckard reads each character as Obsidian Tasks does?', 'Import Statuses')) === 'Import Statuses') {
      await run('deckard.importObsidianStatuses');
    }
    return;
  }
  if (workspaceState.get<boolean>(STATUS_MOVE_OFFERED) === true) {
    return;
  }
  const movable = countStatusMove(planFromIndex(indexer, undefined).lines).character;
  if (movable === 0) {
    return;
  }
  await workspaceState.update(STATUS_MOVE_OFFERED, true);
  const chosen = await show(
    `${pluralize(movable, 'task keeps its status in a #status tag', 'tasks keep their status in a #status tag')}, which Deckard no longer reads.`,
    'Preview the Move',
    'Later',
  );
  if (chosen === 'Preview the Move') {
    await run('deckard.moveStatusTagsIntoCheckboxes');
  }
}
