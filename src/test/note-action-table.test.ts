import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { createQueryContext } from '../domain/query/queryContext';
import { NOTE_ACTIONS, noteActionMenuWhen, notePageActions } from '../ui/commands/noteActionTable';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { renderPage } from './pages';
import { openWebviewPage } from './webviewPage';

/** The manifest, as VS Code reads the menus and the commands' titles. */
const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    menus: Record<string, Array<{ command?: string; when?: string; group?: string }>>;
  };
};

suite('The note-action table', () => {
  test('the editor\'s Deckard submenu is the same table, in the same order, under the commands\' own titles', () => {
    const counts = new Map<string, number>();
    const expected = NOTE_ACTIONS.map((action) => {
      counts.set(action.group, (counts.get(action.group) ?? 0) + 1);
      const when = noteActionMenuWhen(action.when);
      return { command: action.command, ...(when ? { when } : {}), group: `${action.group}@${counts.get(action.group)}` };
    });
    assert.deepStrictEqual(MANIFEST.contributes.menus['deckard.editor.context'], expected);
    const titles = new Map(MANIFEST.contributes.commands.map((command) => [command.command, command.title]));
    assert.deepStrictEqual(NOTE_ACTIONS.map((action) => titles.get(action.command)), NOTE_ACTIONS.map((action) => action.title));
  });

  test('the note page lists only what makes sense outside the editor', () => {
    assert.deepStrictEqual(notePageActions({ pinned: false, parked: false }).map((action) => action.title), [
      'Open Related Notes',
      'Open Notes Graph Around This Note',
      'Pin Note to Home',
      'Park Note',
    ]);
    assert.deepStrictEqual(notePageActions({ pinned: true, parked: true }).map((action) => action.title).slice(-2), ['Unpin Note from Home', 'Unpark Note']);
  });

  test('a daily note\'s ‹ › in the title bar wait for its lens to be off', () => {
    const title = MANIFEST.contributes.menus['editor/title'];
    const daily = title.filter((entry) => /DailyNote$/.test(entry.command ?? '')).map((entry) => [entry.command, entry.when, entry.group]);
    assert.deepStrictEqual(daily, [
      ['deckard.previousDailyNote', 'resourceLangId == markdown && deckard.isDailyNote && deckard.dailyNoteLensOff', 'navigation@10'],
      ['deckard.nextDailyNote', 'resourceLangId == markdown && deckard.isDailyNote && deckard.dailyNoteLensOff', 'navigation@11'],
    ]);
    assert.ok(title.some((entry) => entry.command === 'deckard.openNotePage' && entry.group === 'navigation@13'), 'Open Note as Page stays');
  });
});

suite('The note page\'s ⋯', () => {
  test('lists the note actions it is sent before Appearance, and runs one by its command', () => {
    const index = buildWorkspaceIndex(new Map([['notes/Atlas.md', parseMarkdown('notes/Atlas.md', '# Atlas\nThe plan.\n')]]));
    const snapshot = {
      ...createNotePageSnapshot(index, 'notes/Atlas.md', {
        queryContext: createQueryContext(Date.now()),
        history: { back: false, forward: false },
        visit: 1,
      }),
      actions: notePageActions({ pinned: false, parked: false }).map((action) => ({ command: action.command, title: action.title })),
    };
    const page = openWebviewPage(renderPage('notePage', { state: snapshot }));
    try {
      const rows = page.findAll('.page-menu [data-action]').map((row) => row.textContent);
      assert.deepStrictEqual(rows.slice(0, 4), ['Open Related Notes', 'Open Notes Graph Around This Note', 'Pin Note to Home', 'Park Note']);
      page.click('.page-menu [data-action="run-note-action"][data-command="deckard.pinNote"]');
      assert.deepStrictEqual(page.lastPosted('runNoteAction'), { type: 'runNoteAction', command: 'deckard.pinNote' });
    } finally {
      page.dispose();
    }
  });
});
