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
import { writeSetting } from '../ui/commands/settings';
import { AgendaGroup, createAgenda, selectAgendaTasks, selectOverdueTasks } from '../ui/state/agendaState';
import { isNamespaceName } from '../ui/state/tagGrouping';
import { resolveTaskMove } from '../ui/state/taskBoardState';
import { AgendaTreeServices } from '../ui/views/agendaTree';
import { countDueTasks } from '../ui/views/taskStatusBar';
import { getCaptureInsertion } from '../domain/capture/captureLines';

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
 * What a Tasks view in a suite reads and writes through: an agenda service
 * over VS Code's settings and the view model, reading tasks with `getTask`
 * as the view's own index does, and the task writes of {@link createTaskWrites}.
 */
export function createAgendaTreeServices(
  getTask: (taskId: string) => Task | undefined,
  writes: TaskWrites = createTaskWrites(),
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
      writeSetting: (key, value) => writeSetting(key, value, vscode.ConfigurationTarget.Global),
    }),
    writes,
    contextKeys: new AgendaContextKeys(),
  };
}
