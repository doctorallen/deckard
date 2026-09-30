// The task writes a suite hands to what it tests, built as the extension
// builds them where it starts: the task service over VS Code's editor and
// the suite's own write history, so nothing one suite writes reaches another.
import * as vscode from 'vscode';

import { createVscodeEditApplier, createVscodeHistoryWriter } from '../platform/vscodeEditApplier';
import { createVscodeWorkspace } from '../platform/vscodeWorkspace';
import { TaskRankKeeper, TaskService } from '../services/taskService';
import { resolveSourceUri } from '../ui/commands/navigation';
import { TaskWrites } from '../ui/commands/taskActions';
import { WorkspaceWriteHistory, WriteHandle } from '../ui/commands/workspaceWrites';

/** Task writes over `history`, carrying ranks to `keepRank`, which drops them by default. */
export function createTaskWrites(
  history: WorkspaceWriteHistory = new WorkspaceWriteHistory(),
  keepRank: TaskRankKeeper = () => undefined,
): TaskWrites {
  return {
    history,
    keepRank,
    tasks: new TaskService<vscode.Uri, WriteHandle>({
      notes: createVscodeEditApplier(),
      history: createVscodeHistoryWriter(history),
      ownWrites: history.ownWrites,
      keepRank,
      resolveUri: (filePath) => resolveSourceUri(filePath),
      configuration: createVscodeWorkspace(),
      clock: { now: () => Date.now() },
    }),
  };
}
