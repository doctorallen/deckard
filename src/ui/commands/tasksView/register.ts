import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { getAgendaQuery, pickAgendaGrouping, registerAgendaCommands } from '../agendaActions';
import { clearSetting } from '../settings';
import { exportTaskCalendarCommand, TaskCalendarFile } from '../taskCalendarFile';
import { registerCommand } from '../runCommand';

/**
 * The Tasks view: its menus (registerAgendaCommands), its grouping, and its
 * search, edited on the Task Board or cleared; and the tasks as a calendar
 * file, exported once or kept up to date.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, agenda } = services;
  const { taskBoard } = services.pages;
  context.subscriptions.push(
    ...registerAgendaCommands({
      view: services.views.agenda,
      agenda,
      writes: services.writes.tasks,
      indexer,
      preferences: services.preferences.move,
    }),
    registerCommand('deckard.agenda.setGrouping', () =>
      pickAgendaGrouping(agenda, indexer.getSnapshot()),
    ),
    // The board is the search editor: the view's search opens there to be
    // tried and changed, and its Save to Tasks view keeps it.
    registerCommand('deckard.agenda.editQuery', () =>
      taskBoard.editTasksViewSearch(getAgendaQuery()),
    ),
    registerCommand('deckard.exportTaskCalendar', () => exportTaskCalendarCommand(indexer)),
    new TaskCalendarFile(indexer).start(),
    registerCommand('deckard.clearAgendaQuery', async () => {
      if (await clearSetting('agenda.query', '')) {
        void vscode.window.showInformationMessage('The Tasks view lists every open task again.');
      }
    }),
  );
}
