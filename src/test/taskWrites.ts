// The task writes a suite hands to what it tests, built as the extension
// builds them where it starts: the task service over VS Code's editor and
// the suite's own write history, so nothing one suite writes reaches another.
import * as vscode from 'vscode';

import { createVscodeEditApplier, createVscodeHistoryWriter } from '../platform/vscodeEditApplier';
import { createVscodeWorkspace } from '../platform/vscodeWorkspace';
import { MoveService } from '../services/moveService';
import { TaskRankKeeper, TaskService } from '../services/taskService';
import { resolveSourceUri } from '../ui/commands/navigation';
import { TaskWrites } from '../ui/commands/taskActions';
import { WorkspaceWriteHistory, WriteHandle } from '../ui/commands/workspaceWrites';
import { Task } from '../domain/model';
import { AgendaService } from '../services/agendaService';
import { AgendaContextKeys } from '../ui/commands/agendaActions';
import { readQueryContext } from '../ui/commands/queryContext';
import { AgendaGroup, createAgenda, selectAgendaTasks, selectOverdueTasks } from '../ui/state/agendaState';
import { isNamespaceName } from '../ui/state/tagGrouping';
import { resolveTaskMove } from '../ui/state/taskBoardState';
import { AgendaTreeServices } from '../ui/views/agendaTree';
import { countDueTasks } from '../ui/views/taskStatusBar';
import { getCaptureInsertion } from '../domain/capture/captureLines';
import { FakeHistory, FakeNotes } from './fakeNotes';
import { FakeSettings } from './fakeWorkspace';
import type { AgendaViewChoices } from '../domain/tasks/agendaGroups';

/**
 * Task writes over `history`, carrying ranks to `keepRank`, which drops them
 * by default, and naming a moved task's note by `paths`, the index's paths.
 */
export function createTaskWrites(
  history: WorkspaceWriteHistory = new WorkspaceWriteHistory(),
  keepRank: TaskRankKeeper = () => undefined,
  paths: { getFilePath(uri: vscode.Uri): string } = { getFilePath: (uri) => vscode.workspace.asRelativePath(uri, false) },
): TaskWrites {
  const workspace = createVscodeWorkspace();
  return {
    history,
    keepRank,
    tasks: new TaskService<vscode.Uri, WriteHandle>({
      notes: createVscodeEditApplier(),
      history: createVscodeHistoryWriter(history),
      ownWrites: history.ownWrites,
      keepRank,
      resolveUri: (filePath) => resolveSourceUri(filePath),
      configuration: workspace,
      clock: { now: () => Date.now() },
    }),
    moves: new MoveService<vscode.Uri, WriteHandle>({
      notes: createVscodeEditApplier(),
      history: createVscodeHistoryWriter(history),
      files: workspace,
      configuration: workspace,
      getFilePath: (uri) => paths.getFilePath(uri),
      keepRank,
      resolveUri: (filePath) => resolveSourceUri(filePath),
      placeInsertion: getCaptureInsertion,
    }),
  };
}

/**
 * Task writes over notes in memory, so a suite can make a note fail to open
 * or refuse an edit, and run without the editor. Each task's path names its
 * note in `notes`. Move to is not among them.
 */
export function createFakeTaskWrites(notes: FakeNotes): TaskWrites {
  const tasks = new TaskService({
    notes,
    history: new FakeHistory(notes),
    ownWrites: { note: () => undefined },
    keepRank: () => undefined,
    resolveUri: async (filePath) => notes.uri(filePath),
    configuration: new FakeSettings(),
    clock: { now: () => Date.now() },
  });
  return {
    history: new WorkspaceWriteHistory(),
    keepRank: () => undefined,
    // The fakes' URIs and handles stand in for VS Code's, which these
    // writes only pass back to the messages that name them.
    tasks: tasks as unknown as TaskService<vscode.Uri, WriteHandle>,
    moves: undefined as unknown as MoveService<vscode.Uri, WriteHandle>,
  };
}

/**
 * What a Tasks view in a suite reads and writes through: an agenda service
 * over VS Code's settings and the view model, reading tasks with `getTask`
 * as the view's own index does, and the task writes of {@link createTaskWrites}.
 */
export function createAgendaTreeServices(
  getTask: (taskId: string) => Task | undefined,
  writes: TaskWrites = createTaskWrites(),
  choices: AgendaViewChoices = {},
): AgendaTreeServices {
  return {
    agenda: new AgendaService<AgendaGroup>({
      configuration: createVscodeWorkspace(),
      index: {
        getSnapshot: () => {
          throw new Error('The suite’s Tasks view has no index of its own.');
        },
        getTask,
        refresh: async () => undefined,
        ready: Promise.resolve(),
      },
      readQueryContext: () => readQueryContext(),
      model: {
        select: selectAgendaTasks,
        build: createAgenda,
        countDue: countDueTasks,
        listOverdue: selectOverdueTasks,
        resolveMove: resolveTaskMove,
        isNamespaceName,
      },
      preferences: {
        value: choices,
        setAgendaGrouping: async () => undefined,
        setAgendaSort: async () => undefined,
      },
    }),
    writes,
    contextKeys: new AgendaContextKeys(),
  };
}
