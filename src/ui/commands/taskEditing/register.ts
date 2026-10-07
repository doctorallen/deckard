import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { moveToCommand } from '../moveTo';
import { editTaskCommand } from '../taskEditor';
import { addTaskCommand, AddTaskStart } from '../addTask';
import { startColumnTask } from '../taskBoardActions';
import { breakIntoStepsCommand, readTaskArgument } from '../taskSteps';
import { toggleTaskDoneCommand } from '../toggleTaskDone';
import { setTaskStatusCommand } from '../setTaskStatus';
import { importObsidianStatusesCommand, moveStatusTagsCommand } from '../statusMove';
import { registerCommand } from '../runCommand';

/**
 * Task editing: Edit Task and Add Task, Break into Steps, Toggle Task Done,
 * Set Task Status…, and Move to….
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const writes = services.writes.tasks;
  context.subscriptions.push(
    // One editor, two commands: Edit Task for the task on the cursor's
    // line, Add Task for a new one anywhere, into the note open or today's.
    registerCommand('deckard.editTask', () =>
      editTaskCommand(indexer),
    ),
    // A board column's + Add task passes its column; the palette, nothing.
    registerCommand('deckard.addTask', async (argument?: unknown) => {
      const start = readAddTaskArgument(argument);
      return start && addTaskCommand(services.writes.addTask, start);
    }),
    // The Task Board runs this with the task it was asked about; an editor
    // menu passes its note, which is not a task.
    registerCommand('deckard.breakIntoSteps', (task?: unknown) =>
      breakIntoStepsCommand(indexer, writes, readTaskArgument(task)),
    ),
    registerCommand('deckard.toggleTaskDone', () =>
      toggleTaskDoneCommand({ paths: indexer, tasks: writes.tasks }),
    ),
    // A card's menu passes the task it was opened on; the palette, nothing.
    registerCommand('deckard.setTaskStatus', (task?: unknown) =>
      setTaskStatusCommand(indexer, writes, readTaskArgument(task)),
    ),
    registerCommand('deckard.moveStatusTagsIntoCheckboxes', () => moveStatusTagsCommand(indexer, services.history, services.preferences.repository)),
    registerCommand('deckard.importObsidianStatuses', () => importObsidianStatusesCommand()),
    registerCommand('deckard.moveTo', () =>
      moveToCommand(indexer, services.preferences.move, writes),
    ),
  );
}

/**
 * What Add Task starts from, read from its argument: a board column's id,
 * as `{ column }`, starts the task in that column, and anything else starts
 * an empty one. Undefined when the column refuses a new task, which it says.
 */
function readAddTaskArgument(argument: unknown): AddTaskStart | undefined {
  const column = argument && typeof argument === 'object' ? (argument as { column?: unknown }).column : undefined;
  if (typeof column !== 'string' || column === '') {
    return {};
  }
  const started = startColumnTask(column);
  if (started.kind === 'refused') {
    void vscode.window.showInformationMessage(started.reason);
    return undefined;
  }
  return { line: started.line };
}
