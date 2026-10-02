import * as vscode from 'vscode';

import { updateTaskBoardSetting } from '../../ui/commands/taskBoardActions';
import { createChooseThemeDeps } from '../../ui/commands/chooseTheme';
import { DeckardTheme } from '../../ui/webview/themeNames';
import { activateDeckard, arrange, arrangementsOf, assertWrittenWhereSet, clearEverywhere, isMultiRoot } from './scopes';

/** A setting Deckard writes where it is set, and how a reader has it written. */
interface WrittenSetting<T> {
  key: string;
  how: string;
  write(value: T): Thenable<unknown>;
  values: [T, T];
}

/** The pair of commands that turn a setting on and off, as one write. */
const toggle =
  (enable: string, disable: string) =>
  (value: boolean): Thenable<unknown> =>
    vscode.commands.executeCommand(value ? enable : disable);

// A method's parameter is checked both ways, so each row keeps its own type.
const SETTINGS: WrittenSetting<unknown>[] = [
  {
    key: 'calendar.dayPanel',
    how: 'the Calendar day panel commands',
    write: toggle('deckard.calendar.openDayPanel', 'deckard.calendar.closeDayPanel'),
    values: [true, false],
  },
  {
    key: 'calendar.showWeekends',
    how: 'the Calendar weekend commands',
    write: toggle('deckard.calendar.includeWeekends', 'deckard.calendar.hideWeekends'),
    values: [true, false],
  },
  {
    key: 'calendar.showRepeats',
    how: 'the Calendar repeat commands',
    write: toggle('deckard.calendar.showRepeats', 'deckard.calendar.hideRepeats'),
    values: [true, false],
  },
  {
    key: 'board.statuses',
    how: "the Task Board's columns",
    write: (value: string[]) => updateTaskBoardSetting('statuses', value),
    values: [['todo', 'done'], ['next', 'later', 'done']],
  },
  {
    key: 'board.statusNamespace',
    how: "the Task Board's status namespace",
    write: (value: string) => updateTaskBoardSetting('statusNamespace', value),
    values: ['stage', 'phase'],
  },
  {
    key: 'theme',
    how: 'Choose Theme…',
    write: (value: DeckardTheme) =>
      createChooseThemeDeps({ current: undefined, show: () => undefined }).writeTheme(value),
    values: ['cooper', 'lcars'],
  },
];

/**
 * Each setting here is written where the value in force is set: the
 * workspace's settings when they set it, else the user's. So a write
 * always changes what the window reads, and writing the old value back
 * undoes it, whichever level holds it.
 */
suite(`Settings written where they are set (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  for (const setting of SETTINGS) {
    suite(`deckard.${setting.key}, through ${setting.how}`, () => {
      teardown(() => clearEverywhere(setting.key));

      for (const arrangement of arrangementsOf(...setting.values)) {
        test(`${arrangement.name}: changes what is in force, and back`, async () => {
          await arrange(setting.key, arrangement);
          await assertWrittenWhereSet(setting.key, setting.write, setting.values);
        });
      }
    });
  }
});
