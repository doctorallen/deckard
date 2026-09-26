import * as vscode from 'vscode';

import { measure } from '../../core/timing';
import { findTaskLineMarks } from '../state/taskLineMarks';

/** How long typing must pause before a changed note is redrawn. */
const DELAY_MS = 150;

/** Reads the three settings the marks answer to, for one note. */
function readOptions(uri: vscode.Uri): { dim: boolean; hints: boolean } {
  const configuration = vscode.workspace.getConfiguration('deckard', uri);
  return {
    dim: configuration.get<boolean>('editor.dimTaskMetadata', true),
    // Zen quiets the editor: the hints go, the dimming stays, since dimming
    // is itself a way of quieting.
    hints:
      configuration.get<boolean>('editor.taskDueHints', true) &&
      !configuration.get<boolean>('zenMode', false),
  };
}

/**
 * Draws a note's task metadata fainter than its words, the overdue date of
 * an open task in the overdue color, and "overdue 5 days" or "due today"
 * after its line.
 *
 * It follows the tag decorations: visible notes only, a short pause after
 * typing, and a redraw when a setting changes. "Today" moves at midnight and
 * when the window comes back into focus.
 */
export class TaskLineDecorations implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private midnight: ReturnType<typeof setTimeout> | undefined;
  private readonly dimType = vscode.window.createTextEditorDecorationType({ opacity: '0.7' });
  private readonly overdueType = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('deckard.overdueForeground'),
  });
  /** Each hint carries its own text and color. */
  private readonly hintType = vscode.window.createTextEditorDecorationType({});

  public constructor(
    private readonly isNotesFile: (uri: vscode.Uri) => boolean,
    private readonly now: () => number = Date.now,
  ) {
    this.disposables.push(
      this.dimType,
      this.overdueType,
      this.hintType,
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.update(editor))),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.schedule(event.document);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.editor') ||
          event.affectsConfiguration('deckard.zenMode') ||
          event.affectsConfiguration('deckard.tasks.needsNewDateAfterDays') ||
          event.affectsConfiguration('deckard.notesFolder') ||
          event.affectsConfiguration('deckard.exclude')
        ) {
          this.updateAll();
        }
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.updateAll();
        }
      }),
    );
    this.armMidnight();
    this.updateAll();
  }

  public dispose(): void {
    this.pending.forEach((handle) => clearTimeout(handle));
    this.pending.clear();
    if (this.midnight) {
      clearTimeout(this.midnight);
    }
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Redraws every visible note. */
  public updateAll(): void {
    vscode.window.visibleTextEditors.forEach((editor) => this.update(editor));
  }

  /** Redraws one editor, or clears it when it shows no note. */
  public update(editor: vscode.TextEditor): void {
    const document = editor.document;
    if (!this.isNotesFile(document.uri)) {
      editor.setDecorations(this.dimType, []);
      editor.setDecorations(this.overdueType, []);
      editor.setDecorations(this.hintType, []);
      return;
    }
    const marks = measure(
      'Task line marks',
      () =>
        findTaskLineMarks(
          document.getText().split(/\r?\n/),
          this.now(),
          readOptions(document.uri),
        ),
      () => `${document.lineCount} lines`,
    );
    const range = (span: { line: number; start: number; end: number }) =>
      new vscode.Range(span.line, span.start, span.line, span.end);
    editor.setDecorations(this.dimType, marks.dim.map(range));
    editor.setDecorations(this.overdueType, marks.overdue.map(range));
    editor.setDecorations(
      this.hintType,
      marks.hints.map((hint): vscode.DecorationOptions => {
        const end = document.lineAt(hint.line).range.end;
        return {
          range: new vscode.Range(end, end),
          renderOptions: {
            after: {
              contentText: hint.text,
              color: new vscode.ThemeColor(
                hint.tone === 'overdue' ? 'deckard.overdueForeground' : 'deckard.taskHintForeground',
              ),
              fontStyle: 'italic',
              margin: '0 0 0 1.5em',
            },
          },
        };
      }),
    );
  }

  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        vscode.window.visibleTextEditors
          .filter((editor) => editor.document.uri.toString() === key)
          .forEach((editor) => this.update(editor));
      }, DELAY_MS),
    );
  }

  /** Redraws just after the next local midnight, when "today" moves. */
  private armMidnight(): void {
    const next = new Date(this.now());
    next.setHours(24, 0, 5, 0);
    this.midnight = setTimeout(() => {
      this.updateAll();
      this.armMidnight();
    }, Math.max(1000, next.getTime() - this.now()));
  }
}
