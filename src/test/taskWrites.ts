// The task writes a suite hands to what it tests, built as the extension
// builds them where it starts: the task service over VS Code's editor and
// the suite's own write history, so nothing one suite writes reaches another.
import * as vscode from 'vscode';

import { createVscodeEditApplier, createVscodeHistoryWriter } from '../platform/vscodeEditApplier';
import { createVscodeWorkspace } from '../platform/vscodeWorkspace';
import { MoveService } from '../services/moveService';
import { TaskRankKeeper, TaskService } from '../services/taskService';
import { getCaptureInsertion } from '../ui/commands/capture';
import { resolveSourceUri } from '../ui/commands/navigation';
import { TaskWrites } from '../ui/commands/taskActions';
import { WorkspaceWriteHistory, WriteHandle } from '../ui/commands/workspaceWrites';

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
