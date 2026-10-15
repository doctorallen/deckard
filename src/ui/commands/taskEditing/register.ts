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
import { NOT_A_PROMISE_COMMAND, notAPromiseCommand, TRACK_PROMISE_COMMAND, trackPromiseCommand } from '../trackPromise';

/**
 * Task editing: Edit Task and Add Task, Break into Steps, Toggle Task Done,
 * Set Task Status…, Move to…, and the lens and lightbulb's Track and Not a
 * promise on a promise in today's note.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const writes = services.writes.tasks;
  context.subscriptions.push(
    // One editor, two commands: Edit Task for the task on the cursor's
    // line, Add Task for a new one anywhere, into the note open or today's.
    // A task line's hover passes its note and line, which the cursor moves
    // to first; a menu's own argument, a file, is not that and is ignored.
    registerCommand('deckard.editTask', async (target?: unknown, line?: unknown) => {
      const at = readTaskLineArgument(target, line);
      if (at) {
        await vscode.window.showTextDocument(vscode.Uri.parse(at.documentUri), {
          selection: new vscode.Range(at.line - 1, 0, at.line - 1, 0),
        });
      }
      return editTaskCommand(indexer);
    }),
    // A board column's + passes its column; the palette, nothing.
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
    // A promise's lens and lightbulb pass its note, its line, and the
    // line's words, which must still read so; Track… asks for the editor.
    registerCommand(TRACK_PROMISE_COMMAND, async (target?: unknown, line?: unknown, text?: unknown, edit?: unknown) => {
      if (typeof target !== 'string' || !Number.isInteger(line) || typeof text !== 'string') {
        return undefined;
      }
      return trackPromiseCommand(indexer, { documentUri: target, line: line as number, text }, { edit: edit === true });
    }),
    registerCommand(NOT_A_PROMISE_COMMAND, async (target?: unknown, text?: unknown) => {
      if (typeof target === 'string' && typeof text === 'string') {
        await notAPromiseCommand(services.promiseMarks, target, text);
      }
    }),
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

/**
 * The note and line (1-based) a task line's hover passes Edit Task, or
 * undefined for anything else.
 */
export function readTaskLineArgument(
  target: unknown,
  line: unknown,
): { documentUri: string; line: number } | undefined {
  return typeof target === 'string' && Number.isInteger(line) && (line as number) >= 1
    ? { documentUri: target, line: line as number }
    : undefined;
}
