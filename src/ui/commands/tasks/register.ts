import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { getAgendaQuery, pickAgendaGrouping, registerAgendaCommands } from '../agendaActions';
import { moveToCommand } from '../moveTo';
import { settingTarget, writeSetting } from '../settings';
import { editTaskCommand } from '../taskEditor';
import { breakIntoStepsCommand, readTaskArgument } from '../taskSteps';
import { toggleTaskDoneCommand } from '../toggleTaskDone';
import { registerCommand } from '../runCommand';

/**
 * Tasks and the Tasks view: the view's menus, its grouping and search, Edit
 * Task and Add Task, Break into Steps, Toggle Task Done, and Move to….
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, agenda } = services;
  const writes = services.writes.tasks;
  const { taskBoard } = services.pages;
  context.subscriptions.push(
    ...registerAgendaCommands({
      view: services.views.agenda,
      agenda,
      writes,
      indexer,
      preferences: services.preferences.move,
    }),
    registerCommand('deckard.agenda.setGrouping', () =>
      pickAgendaGrouping(agenda, indexer.getSnapshot()),
    ),
    // The board is the search editor: the view's search opens there to be
    // tried and changed, and its Tasks view button keeps it.
    registerCommand('deckard.agenda.editQuery', () =>
      taskBoard.show(getAgendaQuery()),
    ),
    registerCommand('deckard.clearAgendaQuery', async () => {
      if (await writeSetting('agenda.query', undefined, settingTarget('agenda.query'))) {
        void vscode.window.showInformationMessage('The Tasks view lists every open task again.');
      }
    }),
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
