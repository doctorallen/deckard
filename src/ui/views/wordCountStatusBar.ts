import * as vscode from 'vscode';

import {
  countNoteWords,
  describeWordCount,
  maskNoteForWords,
} from '../../core/markdown/wordCount';

const RECOUNT_DELAY_MS = 250;

/**
 * The words in the note in the editor, or in its selection, beside the task
 * count in the status bar. It is hidden anywhere but a note, and like any
 * status bar item it can be hidden from the status bar's own context menu.
 */
export class WordCountStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The masked lines of one version of one note, reused for selections. */
  private cache: { uri: string; version: number; masked: string[]; total: number } | undefined;
  private visible = false;

  public constructor(private readonly isNotesFile: (uri: vscode.Uri) => boolean) {
    this.item = vscode.window.createStatusBarItem('deckard.wordCount', vscode.StatusBarAlignment.Right, 99);
    this.item.name = 'Deckard word count';
    this.disposables.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.schedule();
        }
      }),
    );
    this.update();
  }

  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** What the item shows now, for a test to read. */
  public get shown(): { text: string; tooltip: string } | undefined {
    return this.visible ? { text: this.item.text, tooltip: String(this.item.tooltip ?? '') } : undefined;
  }

  /** Counts the active note now. */
  public update(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void {
    if (!editor || !this.isNotesFile(editor.document.uri)) {
      this.visible = false;
      this.item.hide();
      return;
    }
    const document = editor.document;
    const key = document.uri.toString();
    if (!this.cache || this.cache.uri !== key || this.cache.version !== document.version) {
      const masked = maskNoteForWords(document.getText().split(/\r?\n/));
      this.cache = { uri: key, version: document.version, masked, total: countNoteWords(masked) };
    }
    const ranges = editor.selections.filter((selection) => !selection.isEmpty);
    const said = describeWordCount(
      this.cache.total,
      ranges.length > 0 ? countNoteWords(this.cache.masked, ranges) : undefined,
    );
    this.item.text = said.text;
    this.item.tooltip = said.tooltip;
    this.visible = true;
    this.item.show();
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.update();
    }, RECOUNT_DELAY_MS);
  }
}
