import * as assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { TermHovers } from '../ui/providers/termHovers';

const lines = (...text: string[]): string => text.join('\n');

/** The notes the hover reads: NDF defined inline on 3 March, UAT never defined, SLO by a term note. */
function termIndex() {
  const on = (day: string) => new Date(`${day}T09:00:00`).getTime();
  const notes: Array<[string, string, string]> = [
    ['FX recon kickoff.md', '2026-03-03', lines('# FX recon kickoff', 'Book the NDF (non-deliverable forward) trades in UAT.')],
    ['a.md', '2026-03-04', lines('# A', 'NDF fixings in UAT')],
    ['b.md', '2026-03-05', lines('# B', 'NDF desk and UAT again')],
    ['Terms/SLO.md', '2026-03-01', lines('---', 'type: term', 'term: SLO', '---', '# SLO', 'Service level objective.')],
  ];
  return buildWorkspaceIndex(
    new Map(notes.map(([filePath, day, content]) => [filePath, parseMarkdown(filePath, content, { createdAt: on(day), updatedAt: on(day) })])),
  );
}

/** A hover's Markdown, as one string. */
function textOf(hover: vscode.Hover | undefined): string {
  return (hover?.contents ?? []).map((content) => (content instanceof vscode.MarkdownString ? content.value : String(content))).join('\n');
}

/**
 * Removes a test's folder, as far as Windows lets it: VS Code holds the
 * folder of a file it has shown for a while after its editor closes, and the
 * folder is in the system's temp folder, which the system clears.
 */
function removeFolder(folder: string): void {
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }
}

suite('Terms in the editor', () => {
  test('a defined term\'s hover says what it means, where, and offers its links; none in code or for a term with no definition', async () => {
    const index = termIndex();
    const changes = new vscode.EventEmitter<unknown>();
    const hovers = new TermHovers({ getSnapshot: () => index, isNotesFile: () => true, onDidUpdate: changes.event });
    const folder = mkdtempSync(path.join(os.tmpdir(), 'deckard-terms-'));
    const file = path.join(folder, 'Today.md');
    writeFileSync(file, lines('# Today', 'Price the NDF and check the SLO in UAT.', '```', 'NDF', '```', 'Then `NDF` again.'));
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const ndf = hovers.provideHover(document, new vscode.Position(1, 11));
      assert.ok(ndf);
      assert.deepStrictEqual([ndf.range?.start.character, ndf.range?.end.character], [10, 13]);
      const text = textOf(ndf);
      assert.match(text, /^\*\*NDF\*\* · \*non-deliverable forward\* · \*3 entries\*/);
      assert.match(text, /\*Defined .+ in FX recon kickoff: "Book the NDF \\\(non-deliverable forward\\\) trades in UAT\\\."\*/);
      for (const link of ['[Open definition](command:deckard.openNote?', '[Find uses](command:deckard.search?', '[Make a term note](command:deckard.makeTermNote?']) {
        assert.ok(text.includes(link), link);
      }
      assert.ok(text.includes(encodeURIComponent(JSON.stringify(['text = NDF']))), 'Find uses searches for the word');

      // A term note's hover names its note, and has no Make a term note.
      const slo = textOf(hovers.provideHover(document, new vscode.Position(1, 30)));
      assert.match(slo, /\*\*SLO\*\* · \*Service level objective\* · \*1 entry\*/);
      assert.ok(slo.includes('*From SLO\\.md*'), slo);
      assert.ok(!slo.includes('Make a term note'));

      assert.strictEqual(hovers.provideHover(document, new vscode.Position(1, 35)), undefined, 'UAT has no definition');
      assert.strictEqual(hovers.provideHover(document, new vscode.Position(3, 1)), undefined, 'fenced code');
      assert.strictEqual(hovers.provideHover(document, new vscode.Position(5, 7)), undefined, 'an inline code span');
      assert.strictEqual(hovers.provideHover(document, new vscode.Position(1, 2)), undefined, 'a word that is no term');
    } finally {
      hovers.dispose();
      changes.dispose();
      removeFolder(folder);
    }
  });

  test('a file that is no note is drawn without reading the workspace’s terms', async () => {
    let read = 0;
    const index = termIndex();
    const changes = new vscode.EventEmitter<unknown>();
    const hovers = new TermHovers({
      getSnapshot: () => {
        read += 1;
        return index;
      },
      isNotesFile: () => false,
      onDidUpdate: changes.event,
    });
    const folder = mkdtempSync(path.join(os.tmpdir(), 'deckard-terms-'));
    const file = path.join(folder, 'Elsewhere.md');
    writeFileSync(file, 'Price the NDF in UAT.');
    try {
      const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      read = 0;
      hovers.draw(editor);
      assert.strictEqual(read, 0);
    } finally {
      hovers.dispose();
      changes.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      removeFolder(folder);
    }
  });
});
