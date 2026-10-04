import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { NavigationService } from '../services/navigationService';
import type { NotePageSnapshot } from '../ui/protocol/notePage';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { NotePageController, NotePageControllerOptions } from '../ui/webview/pages/notePage/notePageController';
import { narrowNotePageMessage } from '../ui/webview/pages/notePage/messages';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { REPOSITORY_ROOT } from './pageWebview';
import { createTaskWrites } from './taskWrites';

/** The note page over three notes, attached to a fake panel. */
function openNotePage() {
  const files = [
    parseMarkdown('notes/Atlas.md', '# Atlas\nSee [[Review]] and [[Review#Notes]].\n'),
    parseMarkdown('notes/Review.md', '# Review\n\n## Notes\nBack to [[Atlas]].\n'),
    parseMarkdown('notes/Other.md', '# Other\n'),
  ];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: (listener: () => void) => updates.event(listener),
  } as unknown as NotePageControllerOptions['indexer'];
  const openedTags: string[] = [];
  const controller = new NotePageController({
    indexer,
    writes: createTaskWrites(),
    navigation: new NavigationService(),
    onOpenTag: (tagKey) => void openedTags.push(tagKey),
    extensionUri: vscode.Uri.file(REPOSITORY_ROOT),
  });
  const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  host.attach(surface);
  const last = (): NotePageSnapshot => {
    const states = surface.webview.posted.filter((message) => (message as { type?: string }).type === 'state');
    return (states[states.length - 1] as { data: NotePageSnapshot }).data;
  };
  return { controller, host, surface, last, send: (message: unknown) => surface.webview.send(message) };
}

suite('The note page host', () => {
  test('draws the note it is asked for, and follows a link to another', async () => {
    const page = openNotePage();
    page.controller.navigate({ filePath: 'notes/Atlas.md' });
    page.host.refresh();
    assert.strictEqual(page.last().title, 'Atlas');
    assert.deepStrictEqual(page.last().history, { back: false, forward: false });

    await page.send({ type: 'openWikiLink', target: 'Review#Notes' });
    assert.strictEqual(page.last().filePath, 'notes/Review.md');
    assert.strictEqual(page.last().focusLine, 3, 'the heading the link names');
    assert.deepStrictEqual(page.last().history, { back: true, forward: false });
  });

  test('steps back and forward through the notes it has shown', async () => {
    const page = openNotePage();
    page.controller.navigate({ filePath: 'notes/Atlas.md' });
    page.host.refresh();
    await page.send({ type: 'openNote', filePath: 'notes/Review.md' });
    await page.send({ type: 'openNote', filePath: 'notes/Other.md' });
    await page.send({ type: 'navigateNoteHistory', direction: 'back' });
    assert.strictEqual(page.last().filePath, 'notes/Review.md');
    await page.send({ type: 'navigateNoteHistory', direction: 'back' });
    assert.strictEqual(page.last().filePath, 'notes/Atlas.md');
    assert.deepStrictEqual(page.last().history, { back: false, forward: true });
    await page.send({ type: 'navigateNoteHistory', direction: 'forward' });
    assert.strictEqual(page.last().filePath, 'notes/Review.md');
    const visits = new Set([page.last().visit]);
    await page.send({ type: 'openNote', filePath: 'notes/Review.md', line: 4 });
    assert.ok(!visits.has(page.last().visit), 'the same note at another line is a new visit, so the page scrolls');
    assert.deepStrictEqual(page.last().history, { back: true, forward: true }, 'but leaves the trail as it was');
  });

  test('opens nothing the index does not have, and refuses what the page may not send', async () => {
    const page = openNotePage();
    page.controller.navigate({ filePath: 'notes/Atlas.md' });
    page.host.refresh();
    await page.send({ type: 'openNote', filePath: 'notes/Gone.md' });
    assert.strictEqual(page.last().filePath, 'notes/Atlas.md');
    assert.strictEqual(narrowNotePageMessage({ type: 'openNote', filePath: 'a.md', line: 0 }), undefined);
    assert.strictEqual(narrowNotePageMessage({ type: 'openNote', filePath: 'a.md', opposite: 'yes' }), undefined);
    assert.deepStrictEqual(narrowNotePageMessage({ type: 'openNote', filePath: 'a.md', line: 2, opposite: true, beside: false, extra: 1 }), {
      type: 'openNote', filePath: 'a.md', line: 2, opposite: true,
    });
    assert.strictEqual(narrowNotePageMessage({ type: 'navigateNoteHistory', direction: 'up' }), undefined);
    assert.deepStrictEqual(narrowNotePageMessage({ type: 'openInEditor', line: 3, beside: true }), { type: 'openInEditor', line: 3, beside: true });
  });

  test('follows a link inside an embed from the note it is written in, and a marker only the note has', async () => {
    const page = openNotePage();
    page.controller.navigate({ filePath: 'notes/Atlas.md' });
    page.host.refresh();
    await page.send({ type: 'openWikiLink', target: '#Notes', from: 'notes/Review.md' });
    assert.strictEqual(page.last().filePath, 'notes/Review.md');
    assert.strictEqual(page.last().focusLine, 3, 'the embedded note’s heading, not the shown note’s');
    await page.send({ type: 'openWikiLink', target: 'Atlas#^constructor' });
    assert.strictEqual(page.last().filePath, 'notes/Atlas.md');
    assert.strictEqual(page.last().focusLine, undefined, 'a marker every object inherits names no line');
    assert.strictEqual(narrowNotePageMessage({ type: 'openWikiLink', target: 'A', from: 3 }), undefined);
    assert.deepStrictEqual(narrowNotePageMessage({ type: 'openWikiLink', target: 'A', from: 'b.md' }), { type: 'openWikiLink', target: 'A', from: 'b.md' });
  });

  test('starts a new trail in a new tab once the reader closes the last', async () => {
    const page = openNotePage();
    page.controller.navigate({ filePath: 'notes/Atlas.md' });
    page.host.refresh();
    page.surface.dispose();
    page.controller.navigate({ filePath: 'notes/Review.md' });
    const reopened = new FakeSurface();
    page.host.attach(reopened);
    page.host.refresh();
    const states = reopened.webview.posted.filter((message) => (message as { type?: string }).type === 'state');
    const shown = (states[states.length - 1] as { data: NotePageSnapshot }).data;
    assert.strictEqual(shown.filePath, 'notes/Review.md');
    assert.deepStrictEqual(shown.history, { back: false, forward: false });
  });

  test('comes back after a reload on the note it showed', async () => {
    const page = openNotePage();
    await page.controller.options.restore?.({ filePath: 'notes/Review.md', line: 4 });
    page.host.refresh();
    assert.strictEqual(page.last().filePath, 'notes/Review.md');
    assert.strictEqual(page.last().focusLine, 4);
  });
});
