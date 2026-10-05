import * as vscode from 'vscode';

import { readEditorToggle } from './editorToggles';
import { KeyedDebouncer } from '../../shared/debounce';
import { measure } from '../../shared/timing';
import { findTaskLineMarks } from '../state/taskLineMarks';
import { readQueryContext } from '../commands/queryContext';

/** How long typing must pause before a changed note is redrawn. */
const DELAY_MS = 150;

/** The settings a change to which redraws every visible note's marks. */
const REDRAW_SETTINGS = [
  'deckard.editor',
  'deckard.tasks.needsNewDateAfterDays',
  'deckard.notesFolder',
  'deckard.exclude',
];

/** Reads the three settings the marks answer to, for one note. */
function readOptions(uri: vscode.Uri): { dim: boolean; hints: boolean } {
  return {
    dim: readEditorToggle('dimTaskMetadata', uri),
    hints: readEditorToggle('taskDueHints', uri),
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
  private readonly pending = new KeyedDebouncer(DELAY_MS);
  private midnight: ReturnType<typeof setTimeout> | undefined;
  private readonly dimType = vscode.window.createTextEditorDecorationType({ opacity: '0.7' });
  private readonly overdueType = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('deckard.overdueForeground'),
  });
  /** Each hint carries its own text and color. */
  private readonly hintType = vscode.window.createTextEditorDecorationType({});
  /** The decoration types, then every listener `register` adds. */
  private readonly disposables: vscode.Disposable[] = [this.dimType, this.overdueType, this.hintType];

  /**
   * Takes the notes test and the clock "today" is read from; nothing is
   * drawn or registered until `register`.
   */
  public constructor(
    private readonly isNotesFile: (uri: vscode.Uri) => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Listens to the editors, documents, settings, and window focus it redraws
   * on, arms the redraw at midnight, and draws every visible note. Returns
   * the decorations, so the composition root can build and register them in
   * one expression.
   */
  public register(): this {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.update(editor))),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.schedule(event.document);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (REDRAW_SETTINGS.some((section) => event.affectsConfiguration(section))) {
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
    return this;
  }

  /** Clears the midnight redraw, pending redraws, and every listener. */
  public dispose(): void {
    this.pending.dispose();
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
          readQueryContext(this.now()),
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

  /** Redraws a changed note's visible editors once typing pauses. */
  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.pending.schedule(key, () => {
      vscode.window.visibleTextEditors
        .filter((editor) => editor.document.uri.toString() === key)
        .forEach((editor) => this.update(editor));
    });
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
