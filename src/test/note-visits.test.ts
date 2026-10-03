import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { NoteVisits, NoteVisitWindow, sectionForVisit } from '../ui/commands/noteVisits';
import { carrySectionIds } from '../domain/ranking/frecency';

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();
  public keys(): readonly string[] {
    return [...this.values.keys()];
  }
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }
  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const settle = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function indexOf(notes: Record<string, string>) {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)])),
  );
}

function createWindow() {
  const editors = new vscode.EventEmitter<vscode.TextEditor | undefined>();
  const states = new vscode.EventEmitter<vscode.WindowState>();
  const window = {
    onDidChangeActiveTextEditor: editors.event,
    onDidChangeWindowState: states.event,
    activeTextEditor: undefined as vscode.TextEditor | undefined,
    state: { focused: true } as vscode.WindowState,
  };
  const open = (filePath: string, line: number) => {
    window.activeTextEditor = {
      document: { uri: vscode.Uri.file(`/ws/${filePath}`) },
      selection: { active: { line: line - 1 } },
    } as unknown as vscode.TextEditor;
    editors.fire(window.activeTextEditor);
  };
  return { window: window as unknown as NoteVisitWindow, open, states, raw: window };
}

suite('A note counts as opened when it stays open', () => {
  const index = indexOf({
    'notes/atlas.md': '---\ntags: [a]\n---\n# Atlas\nIntro.\n## Next\nWork.\n',
    'notes/plain.md': 'No headings here.\n',
  });
  const indexer = {
    getSnapshot: () => index,
    getFilePath: (uri: vscode.Uri) => uri.path.replace('/ws/', ''),
    isNotesFile: () => true,
  };
  const next = [...index.sections.values()].find((section) => section.heading === 'Next')!;
  const atlas = [...index.sections.values()].find((section) => section.heading === 'Atlas')!;

  test('records the cursor\'s heading once the note has stayed a moment, quietly', async () => {
    const preferences = createPreferences(new MemoryMemento());
    let loud = 0;
    let quiet = 0;
    preferences.reader.onDidChange(() => (loud += 1));
    preferences.reader.onDidRecordVisit(() => (quiet += 1));
    const { window, open } = createWindow();
    const visits = new NoteVisits(indexer, preferences, { dwellMs: 30, window });
    try {
      open('notes/atlas.md', 7);
      await settle(80);
      assert.strictEqual(preferences.reader.value.sectionAccessCounts[next.id], 1);
      assert.deepStrictEqual([loud, quiet], [0, 1]);
      // The same heading again within ten minutes is not a second visit.
      open('notes/plain.md', 1);
      open('notes/atlas.md', 7);
      await settle(80);
      assert.strictEqual(preferences.reader.value.sectionAccessCounts[next.id], 1);
    } finally {
      visits.dispose();
    }
  });

  test('switching away before the moment is up records nothing', async () => {
    const preferences = createPreferences(new MemoryMemento());
    const { window, open, states } = createWindow();
    const visits = new NoteVisits(indexer, preferences, { dwellMs: 40, window });
    try {
      open('notes/atlas.md', 7);
      await settle(10);
      open('notes/plain.md', 1);
      await settle(80);
      assert.deepStrictEqual(preferences.reader.value.sectionAccessCounts, {});
      open('notes/atlas.md', 7);
      states.fire({ focused: false } as vscode.WindowState);
      await settle(80);
      assert.deepStrictEqual(preferences.reader.value.sectionAccessCounts, {}, 'a window that lost focus');
    } finally {
      visits.dispose();
    }
  });

  test('above every heading counts the first, and a note without one counts nothing', () => {
    const file = index.files.get('notes/atlas.md')!;
    assert.strictEqual(sectionForVisit(file, 1)?.id, atlas.id);
    assert.strictEqual(sectionForVisit(file, 5)?.id, atlas.id);
    assert.strictEqual(sectionForVisit(file, 7)?.id, next.id);
    assert.strictEqual(sectionForVisit(index.files.get('notes/plain.md')!, 1), undefined);
  });

  test('a heading pushed down by a new line keeps its view count', async () => {
    const before = indexOf({ 'notes/a.md': '# A\n## Same\none\n## Same\ntwo\n## Gone\n' });
    const after = indexOf({ 'notes/a.md': 'New line.\n# A\n## Same\none\n## Same\ntwo\n' });
    const ids = (index: ReturnType<typeof indexOf>, heading: string) =>
      [...index.sections.values()].filter((section) => section.heading === heading).sort((l, r) => l.startLine - r.startLine).map((section) => section.id);
    const moved = carrySectionIds(before, after);
    assert.strictEqual(moved.get(ids(before, 'Same')[0]), ids(after, 'Same')[0]);
    assert.strictEqual(moved.get(ids(before, 'Same')[1]), ids(after, 'Same')[1]);
    assert.strictEqual(moved.get(ids(before, 'Gone')[0]), undefined);

    const preferences = createPreferences(new MemoryMemento());
    await preferences.usage.recordSectionAccess(ids(before, 'Same')[0], 100);
    await preferences.usage.recordSectionAccess(ids(after, 'Same')[0], 50);
    await preferences.usage.carrySectionAccess(moved);
    assert.strictEqual(preferences.reader.value.sectionAccessCounts[ids(after, 'Same')[0]], 2);
    assert.strictEqual(preferences.reader.value.sectionAccessTimes?.[ids(after, 'Same')[0]], 100);
    assert.strictEqual(preferences.reader.value.sectionAccessCounts[ids(before, 'Same')[0]], undefined);
  });
});
