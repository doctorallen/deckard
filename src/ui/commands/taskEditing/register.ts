import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { moveToCommand } from '../moveTo';
import { editTaskCommand } from '../taskEditor';
import { breakIntoStepsCommand, readTaskArgument } from '../taskSteps';
import { toggleTaskDoneCommand } from '../toggleTaskDone';
import { registerCommand } from '../runCommand';

/**
 * Task editing: Edit Task and Add Task, Break into Steps, Toggle Task Done,
 * and Move to….
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const writes = services.writes.tasks;
  context.subscriptions.push(
    // One editor, two names: which one the palette offers is decided by
    // whether the cursor is on a task.
    registerCommand('deckard.editTask', () =>
      editTaskCommand(indexer),
    ),
    registerCommand('deckard.addTask', () =>
      editTaskCommand(indexer),
    ),
    // The Task Board runs this with the task it was asked about; an editor
    // menu passes its note, which is not a task.
    registerCommand('deckard.breakIntoSteps', (task?: unknown) =>
      breakIntoStepsCommand(indexer, writes, readTaskArgument(task)),
    ),
    registerCommand('deckard.toggleTaskDone', () =>
      toggleTaskDoneCommand({ paths: indexer, tasks: writes.tasks }),
    ),
    registerCommand('deckard.moveTo', () =>
      moveToCommand(indexer, services.preferences.move, writes),
    ),
  );
}
