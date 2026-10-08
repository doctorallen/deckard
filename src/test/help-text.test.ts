import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import type { RankedNote } from '../domain/model';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { createPreferences, TestPreferences } from './preferenceServices';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { readSheet } from './sheets';

/**
 * Zen's help step hides one class, .help-text, so each line that teaches
 * rather than shows carries it where it is drawn, and a line that says
 * what is there, a count, or a control never does.
 */
suite('Help text', () => {
  let page: WebviewPage | undefined;
  let store: TestPreferences | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.repository.dispose();
    store = undefined;
  });

  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const index = () => buildWorkspaceIndex(new Map([
    ['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal #project/atlas\n')],
  ]));
  const preferences = () => {
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    return store.reader.value;
  };

  /** The text of each .help-text the page draws, in order. */
  const taught = (shown: WebviewPage): string[] => shown.findAll('.help-text').map((line) => (line.textContent ?? '').trim());

  /** No .help-text holds a control, or the parse error that shares the hint's slot. */
  const holdsNoControl = (shown: WebviewPage): void => {
    for (const line of shown.findAll('.help-text')) {
      assert.strictEqual(line.matches('button, input, select, a, summary, [data-action], .query-error'), false, `${line.className} is not a control`);
      assert.strictEqual(line.querySelector('button, input, select, a, summary, [data-action], .query-error'), null, `${line.className} holds no control`);
    }
  };

  test('the sheet hides the one class, and no other line', () => {
    const sheet = readSheet('shared/display.css');
    assert.match(sheet, /body\[data-help=hidden\] \.help-text \{ display: none; \}/);
    assert.strictEqual(/body\[data-help=hidden\] \.(query-hint|refine-hint|home-hint-bar)/.test(sheet), false, 'the three old selectors are gone');
  });

  test('the query hint and the builder\'s paragraph teach; the builder\'s rows do not', () => {
    const snapshot = createSearchPageSnapshot(index(), preferences(), '#project/atlas', { queryContext: createQueryContext(NOW) });
    page = openWebviewPage(renderPage('searchPage'), snapshot);
    assert.ok(page.find('.query-hint').classList.contains('help-text'));
    page.click('[data-action="toggle-builder"]');
    const note = page.findAll('.query-builder-note').find((line) => /^In a new row/.test(line.textContent ?? ''));
    assert.ok(note?.classList.contains('help-text'), 'the builder\'s paragraph');
    holdsNoControl(page);
  });

  test('an empty board column says it is empty, and teaches the drag apart', () => {
    const board = createTaskBoard({
      index: index(),
      preferences: { ...preferences(), taskBoardLayout: 'board' },
      search: { query: '' },
      options: { queryContext: createQueryContext(NOW), format: 'emoji' },
    });
    page = openWebviewPage(renderPage('taskBoard'), board);
    const empty = page.findAll('.board-empty').find((line) => line.querySelector('.help-text'));
    assert.ok(empty, 'a droppable column with nothing in it');
    assert.strictEqual(empty?.textContent, 'No tasks. Drag a card here, or right-click one.', 'the words are as they were');
    assert.strictEqual(empty?.querySelector('.help-text')?.textContent, ' Drag a card here, or right-click one.', 'the state line stays outside the class');
    assert.ok(taught(page).includes('Columns when grouped by Status, one per status in your list. Tick one to show it, drag to set the order. Done is always a column; a character no status names gets one of its own.'));
    assert.strictEqual(page.find('.board-count').classList.contains('help-text'), false, 'a count is never help');
    holdsNoControl(page);
  });

  test('Task Statuses teaches its first sentence and keeps where it saves', () => {
    page = openWebviewPage(renderPage('taskStatuses'), {
      statuses: [{ symbol: ' ', name: 'Todo', type: 'todo', next: 'x' }, { symbol: 'x', name: 'Done', type: 'done', next: ' ' }],
      checkboxClick: 'done',
      found: [],
      canImport: false,
      target: 'workspace',
    });
    assert.strictEqual(page.text('.status-note'), "What each checkbox character means. Saved to your workspace's settings.");
    assert.deepStrictEqual(taught(page), ['What each checkbox character means.'], 'where it is saved is state, and shows');
    holdsNoControl(page);
  });

  test('the Graph teaches "Open a note" only until a note is open', () => {
    page = openWebviewPage(renderPage('notesGraph'), undefined, { canvas: true });
    const line = page.find('#focus-note');
    assert.strictEqual(line.textContent, 'Open a note to draw the graph around it.');
    assert.ok(line.classList.contains('help-text'));
    page.send({
      updatedAt: 1,
      nodes: [{ id: 'section:atlas', kind: 'note', title: 'atlas', tagKeys: [], degree: 0, filePath: 'notes/atlas.md', line: 1 }],
      edges: [],
      tags: [],
      totalNoteCount: 1,
      totalTaskCount: 0,
      focus: { local: false, depth: 1, skipPeriodic: true, workspaceNodeCount: 1, filePath: 'notes/atlas.md', title: 'atlas' },
    });
    assert.strictEqual(page.text('#focus-note'), 'Around atlas, when this is on.');
    assert.strictEqual(page.find('#focus-note').classList.contains('help-text'), false, 'a line that names the note stays');
  });

  test('Context teaches why a result is listed, and keeps the result', () => {
    const similar: RankedNote = {
      sectionId: 'section-1',
      filePath: 'notes/audit.md',
      title: 'Northwind audit',
      fileName: 'audit.md',
      sourceLine: 3,
      headingPath: ['Northwind audit'],
      titleTags: [],
      matchedTags: [],
      matchCount: 0,
      totalTagCount: 0,
      overlap: 0,
      relevanceScore: 24,
      kind: 'wording',
      reasons: ['Similar terms: northwind, route'],
    };
    page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: 'today.md',
      activeTags: [],
      notes: [],
      state: 'noTags',
      similar: { notes: [similar], tags: [] },
    });
    assert.deepStrictEqual(taught(page), ['These share words with this note, not tags or links.', 'Similar terms: northwind, route']);
    assert.strictEqual(page.find('.note-title').closest('.help-text'), null, 'the result itself is not help');
    holdsNoControl(page);
  });
});
