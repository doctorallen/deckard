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

// A method's parameter is checked both ways, so each row keeps its own type.
const SETTINGS: WrittenSetting<unknown>[] = [
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
