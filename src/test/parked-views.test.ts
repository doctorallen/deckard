import * as assert from 'assert';

import * as vscode from 'vscode';

import { createPreferences } from './preferenceServices';
import { PersistedPreferences } from '../core/types';
import { buildSetupReport, SetupFacts } from '../ui/commands/checkSetup';
import { TagCompletionProvider } from '../ui/providers/tagSuggestions';
import { createDeckardStatsSnapshot } from '../ui/state/dashboardState';
import { collectNoteLinks } from '../ui/state/noteLinks';
import { createNotesGraphSnapshot, graphInputsChanged } from '../ui/state/notesGraphState';
import { createSidebarSnapshot } from '../ui/state/relatedNotesRanking';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getStatsHtml } from '../ui/webview/statsHtml';
import { indexWithParking } from './parkedFixture';
import { openWebviewPage } from './webviewPage';

function defaults(values: Partial<PersistedPreferences> = {}): PersistedPreferences {
  const store = createPreferences({
    get: () => undefined,
    keys: () => [],
    update: async () => undefined,
  } as never);
  const value = { ...store.reader.value, ...values };
  store.repository.dispose();
  return value;
}

const NOTES: Record<string, string> = {
  'notes/Atlas.md': '# Atlas #project/atlas\nThe plan.\n',
  'notes/Plan.md': '# Plan #project/atlas\nSee [[Atlas]].\n',
  'archive/Old plan.md': '# Old plan #project/atlas #era/old\nSee [[Atlas]].\n- [ ] Old step\n',
};

function workspace() {
  return indexWithParking(NOTES, { folders: ['archive'] });
}

suite('Parked notes stay out of Related Notes, the graph, and completion', () => {
  test('Related Notes leaves a parked note out, and keeps it, last, beside a parked note', () => {
    const index = workspace();
    const related = (filePath: string) =>
      createSidebarSnapshot(index, filePath, index.files.get(filePath), {
        now: Date.now(),
      }).notes.map((note) => [
        note.filePath,
        note.parked === true,
      ]);
    assert.deepStrictEqual(related('notes/Atlas.md'), [['notes/Plan.md', false]]);
    // Beside a parked note, the rest are still ranked; no other note is parked.
    const fromParked = related('archive/Old plan.md').map(([filePath]) => filePath).sort();
    assert.deepStrictEqual(fromParked, ['notes/Atlas.md', 'notes/Plan.md']);
  });

  test('Linked from keeps a parked note that links here, after the rest, and says so', () => {
    const index = workspace();
    const links = collectNoteLinks(index, index.files.get('notes/Atlas.md')!, { now: Date.now() });
    assert.deepStrictEqual(
      links.linkedFromNotes.map((group) => [group.filePath, group.parked === true]),
      [
        ['notes/Plan.md', false],
        ['archive/Old plan.md', true],
      ],
    );
  });

  test('the graph marks parked nodes and tags only parked notes carry', () => {
    const graph = createNotesGraphSnapshot(workspace());
    const parked = graph.nodes.filter((node) => node.parked).map((node) => node.title).sort();
    assert.deepStrictEqual(parked, ['#era/old', 'Old plan', 'Old step']);
  });

  test('a change to what is parked redraws the graph though no note changed', () => {
    const before = workspace();
    const after = { ...before, parked: indexWithParking(NOTES).parked };
    assert.strictEqual(graphInputsChanged(before, after), true);
    const same = { ...before, parked: workspace().parked };
    assert.strictEqual(graphInputsChanged(before, same), false);
  });

  test('the graph has a Show parked switch, off until chosen', () => {
    const page = openWebviewPage(getNotesGraphHtml({ cspSource: 'vscode-webview://deckard' }));
    try {
      const toggle = page.find('#show-parked') as HTMLInputElement;
      assert.strictEqual(toggle.type, 'checkbox');
      assert.strictEqual(toggle.checked, false);
      assert.match(toggle.parentElement?.textContent ?? '', /Show parked/);
      page.click('#show-parked');
      assert.strictEqual((page.savedState() as { showParked: boolean }).showParked, true);
    } finally {
      page.dispose();
    }
  });

  test('tag completion leaves out a tag only parked notes carry, except in a parked note', async () => {
    const index = workspace();
    const provider = new TagCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () => index,
      getFilePath: (uri) => uri.path.replace('/tmp/deckard/', ''),
    });
    const document = (path: string) =>
      ({
        uri: vscode.Uri.file(`/tmp/deckard/${path}`),
        getText: () => 'Now #er',
        lineAt: () => ({ text: 'Now #er' }),
      }) as unknown as vscode.TextDocument;
    const labels = async (path: string) =>
      (await provider.provideCompletionItems(document(path), new vscode.Position(0, 7))).map(
        (item) => item.label,
      );
    assert.deepStrictEqual(await labels('notes/Plan.md'), []);
    assert.deepStrictEqual(await labels('archive/Old plan.md'), ['#era/old']);
    provider.dispose();
  });

  test('Stats leaves parked notes out of the unlinked ones, and says how much is parked', () => {
    const index = workspace();
    const stats = createDeckardStatsSnapshot(index, defaults(), [], Date.now());
    assert.ok(!stats.orphanNotes.some((note) => note.detail === 'archive/Old plan.md'));
    assert.deepStrictEqual(stats.parked, { notes: 1, openTasks: 1 });
    const page = openWebviewPage(getStatsHtml({ cspSource: 'vscode-webview://deckard' } as never), stats);
    try {
      assert.strictEqual(page.text('.parked-line'), 'Parked: 1 note, 1 open task');
      page.click('.parked-line button');
      assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'is:parked' });
    } finally {
      page.dispose();
    }
    assert.strictEqual(createDeckardStatsSnapshot(indexWithParking({ 'a.md': '# A\n' }), defaults(), [], Date.now()).parked, undefined);
  });

  test('Check My Setup says how many notes are parked, and warns when all are', () => {
    const facts: SetupFacts = {
      folders: [{ name: 'notes', notesFolder: '', notesFolderExists: true }],
      scan: { found: 10, templates: 0, excluded: 0, read: 10 },
      excludePatterns: [],
      unreadable: [],
      indexed: { files: 10, sections: 20, tasks: 5, tags: 4 },
      parked: { byFolder: 6, byTag: 1 },
      personMarker: '@',
      people: 0,
      meIsKnown: false,
      tasksForMe: 0,
    };
    assert.match(buildSetupReport(facts), /7 notes are parked: 6 by `deckard.parked.folders` and 1 by a parked tag\./);
    assert.match(
      buildSetupReport({ ...facts, parked: { byFolder: 10, byTag: 0 } }),
      /⚠️ Every note is parked, so the Tasks view and Related Notes will be empty\./,
    );
  });
});
