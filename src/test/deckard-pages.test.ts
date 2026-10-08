import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { DECKARD_PAGE_COMMANDS, isDeckardPageId, listDeckardPages, PageFacts } from '../ui/state/deckardPages';

const ROOT = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string }[];
    views: { deckard: { id: string }[] };
    menus: { 'view/title': { command: string; when?: string }[] };
    keybindings: { command: string; key: string; mac?: string }[];
  };
};

/** A Sunday in October with three due today and two overdue. */
const FACTS: PageFacts = {
  dueToday: 3,
  overdue: 2,
  notes: 1,
  files: 1240,
  today: new Date(2026, 9, 4),
  todayNoteExists: false,
  findKey: 'Cmd+Shift+Alt+F',
};

suite('Deckard pages: the top of Context and Go to…', () => {
  test('lists every page in order, each with a hint from the notes as they are', () => {
    const pages = listDeckardPages(FACTS);
    assert.deepStrictEqual(pages.map((page) => page.label), ['Home', 'Task Board', 'Calendar', "Today's note", 'Notes Graph', 'Find in Notes…', 'Stats', 'Help']);
    assert.deepStrictEqual(pages.map((page) => page.description), [
      '3 tasks due today',
      '2 tasks overdue',
      'October 2026',
      'Sun, Oct 4 · not written yet',
      '1 note',
      'Cmd+Shift+Alt+F',
      '1,240 files',
      'Get Started and the guide',
    ]);
  });

  test('a quiet day says what each page is instead', () => {
    const pages = listDeckardPages({ ...FACTS, dueToday: 0, overdue: 0, todayNoteExists: true });
    assert.deepStrictEqual(pages.slice(0, 4).map((page) => page.description), ['Nothing due today', 'Tasks as columns', 'October 2026', 'Sun, Oct 4']);
  });

  test('a page id from a page\'s menu is one of the pages, and nothing else', () => {
    assert.deepStrictEqual(listDeckardPages(FACTS).map((page) => [page.id, page.command]), Object.entries(DECKARD_PAGE_COMMANDS));
    assert.ok(isDeckardPageId('board'));
    for (const value of ['constructor', 'toString', 'Board', '', undefined, 3]) {
      assert.ok(!isDeckardPageId(value), String(value));
    }
  });

  test('each page opens a contributed command and has a glyph for light and dark', () => {
    const commands = new Set(manifest.contributes.commands.map((command) => command.command));
    for (const page of listDeckardPages(FACTS)) {
      assert.ok(commands.has(page.command), page.command);
      for (const look of ['light', 'dark']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'resources', 'pages', `${page.id}-${look}.svg`)), `${page.id}-${look}.svg`);
      }
    }
  });

  test('Context is first in the sidebar, with no Pages view, Go to… has its key, and Context\'s title bar carries no page icons', () => {
    assert.strictEqual(manifest.contributes.views.deckard[0].id, 'deckard.relatedNotes', 'the pages are drawn at its top');
    assert.ok(!manifest.contributes.views.deckard.some((view) => view.id === 'deckard.pages'), 'no view of their own');
    assert.deepStrictEqual(
      manifest.contributes.keybindings.find((binding) => binding.command === 'deckard.goTo'),
      { command: 'deckard.goTo', key: 'ctrl+shift+alt+p', mac: 'cmd+shift+alt+p' },
    );
    const pageCommands = new Set(listDeckardPages(FACTS).map((page) => page.command));
    const onContext = manifest.contributes.menus['view/title'].filter((item) => item.when === 'view == deckard.relatedNotes' && pageCommands.has(item.command));
    assert.deepStrictEqual(onContext, []);
  });
});
