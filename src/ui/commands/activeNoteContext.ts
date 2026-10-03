import * as vscode from 'vscode';

import { Debouncer } from '../../shared/debounce';
import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { findFencedLines } from '../../domain/markdown/lineShapes';
import { findDailyNoteDate } from '../../domain/markdown/parser';

/** What the context needs to know about the index. */
export interface ActiveNoteIndex {
  isNotesFile(uri: vscode.Uri): boolean;
  getFilePath(uri: vscode.Uri): string;
}

/** Sets a context key; injectable so a test can read back what was set. */
export type ContextSetter = (key: string, value: boolean) => void;

const setContext: ContextSetter = (key, value) => {
  void vscode.commands.executeCommand('setContext', key, value);
};

/**
 * The top-level headings of a note's text, outside front matter and fenced
 * code, as a daily note's date may be read from its H1.
 */
export function readTopHeadings(lines: readonly string[]): string[] {
  const headings: string[] = [];
  const start = (findFrontmatterEnd(lines) ?? -1) + 1;
  // Fenced code is found as the parser finds it, so the two agree on which
  // headings are examples.
  const fenced = findFencedLines(lines);
  for (let at = start; at < lines.length; at += 1) {
    if (fenced.has(at)) {
      continue;
    }
    const heading = /^#[ \t]+(.+?)[ \t#]*$/.exec(lines[at]);
    if (heading) {
      headings.push(heading[1]);
    }
  }
  return headings;
}

/** Whether a note, by its path and text, is a daily note. */
export function isDailyNoteText(filePath: string, lines: readonly string[]): boolean {
  return findDailyNoteDate(filePath, readTopHeadings(lines)) !== undefined;
}

/**
 * Keeps `deckard.isNote` and `deckard.isDailyNote` in step with the active
 * editor, so the title bar offers Deckard's button on a note and the arrows
 * between days on a daily note, and nowhere else.
 *
 * A daily note is read by the rule the index uses — a date as the file name,
 * or in the first heading — from the editor's own text, so a note gains its
 * arrows as its heading is typed, before it is saved.
 */
export class ActiveNoteContext implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly state = new Map<string, boolean>();
  /** The re-read waiting for typing in the active note to pause. */
  private readonly pendingSync = new Debouncer(200);

  /**
   * Starts listening to the active editor, its typing, and Deckard's settings,
   * and sets both keys for the editor already open.
   */
  public constructor(
    private readonly index: ActiveNoteIndex,
    private readonly set: ContextSetter = setContext,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.sync(editor)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.schedule();
        }
      }),
      // A change to what counts as a note moves the answer too.
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard')) {
          this.sync(vscode.window.activeTextEditor);
        }
      }),
    );
    this.sync(vscode.window.activeTextEditor);
  }

  /** Stops listening and drops any re-read still waiting on a pause in typing. */
  public dispose(): void {
    this.pendingSync.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Reads the editor, and tells VS Code only what has changed. */
  public sync(editor: vscode.TextEditor | undefined): void {
    const document = editor?.document;
    const isNote = document !== undefined && this.index.isNotesFile(document.uri);
    const isDaily =
      isNote &&
      isDailyNoteText(
        this.index.getFilePath(document.uri),
        Array.from({ length: Math.min(document.lineCount, 200) }, (_, at) =>
          document.lineAt(at).text,
        ),
      );
    this.update('deckard.isNote', isNote);
    this.update('deckard.isDailyNote', isDaily);
  }

  /** Re-reads the active note once typing in it pauses, not on every keystroke. */
  private schedule(): void {
    this.pendingSync.schedule(() => this.sync(vscode.window.activeTextEditor));
  }

  /** Sets a key only when its value changed, so VS Code is not told the same thing twice. */
  private update(key: string, value: boolean): void {
    if (this.state.get(key) === value) {
      return;
    }
    this.state.set(key, value);
    this.set(key, value);
  }
}
