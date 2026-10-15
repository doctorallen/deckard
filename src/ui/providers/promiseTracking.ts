import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../domain/model';
import type { PromiseLine } from '../../domain/tasks/promises';
import { KeyedDebouncer } from '../../shared/debounce';
import { measure } from '../../shared/timing';
import { isMarkdownFile } from '../../core/workspace/scanner';
import type { Event } from '../../ports/events';
import {
  createPromiseEdit,
  describePromise,
  findOpenPromises,
  formatPromiseLine,
  isTodaysNote,
  NOT_A_PROMISE_COMMAND,
  PromiseMarks,
  TRACK_PROMISE_COMMAND,
} from '../commands/trackPromise';
import { readEditorToggle } from './editorToggles';

/** How long typing must pause before a changed note's marks are drawn again. */
const DRAW_DELAY_MS = 300;

/** What the offers read from the index. */
export interface PromiseIndexSource {
  getSnapshot(): WorkspaceIndex;
  isNotesFile(uri: vscode.Uri): boolean;
}

/** What remembers Not a promise, and says when it changes. */
export interface PromiseMarkSource extends Pick<PromiseMarks, 'has'> {
  readonly onDidChange: Event<void>;
}

/**
 * Said they would (docs/implementation/41-said-they-would.md): in today's
 * daily note, a line naming one person and a day to come has its day
 * words underlined, a lens above it, **Track: Sam · Fri, Oct 17** and
 * **Not a promise**, and the same in the lightbulb, with **Track as waiting
 * on Sam…**, which opens the task editor first. `deckard.editor.trackPromises`
 * turns all three off; other notes, and old daily notes, are left alone.
 */
export class PromiseTracking
  implements vscode.CodeLensProvider, vscode.CodeActionProvider, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly pending = new KeyedDebouncer(DRAW_DELAY_MS);
  /** A faint wavy line under the day words, in a color a theme can set. */
  private readonly underlineType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline wavy var(--vscode-deckard-promiseUnderline)',
  });
  /** The decoration type and the emitter, then every listener `register` adds. */
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter, this.underlineType];

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  /**
   * Takes the index, Not a promise's marks, and the clock "today" is read
   * from; nothing is drawn or registered until `register`.
   */
  public constructor(
    private readonly index: PromiseIndexSource,
    private readonly marks: PromiseMarkSource,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Registers the lenses and the quick fixes for Markdown files, listens to
   * the editors, the settings, and the marks, and draws every visible
   * editor. Returns the provider, so the composition root can build and
   * register it in one expression.
   */
  public register(): this {
    const markdown = { pattern: '**/*.md' };
    this.disposables.push(
      vscode.languages.registerCodeLensProvider(markdown, this),
      vscode.languages.registerCodeActionsProvider(markdown, this, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }),
      this.marks.onDidChange(() => this.redraw()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard')) {
          this.redraw();
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.draw(editor))),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.schedule(event.document);
        }
      }),
      // A day may have turned while the window was away.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.redraw();
        }
      }),
    );
    vscode.window.visibleTextEditors.forEach((editor) => this.draw(editor));
    return this;
  }

  /** Clears pending draws, the marks drawn, and every listener. */
  public dispose(): void {
    this.pending.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * The promises of a document, when it is a note, today's daily note, and
   * the setting is on; none otherwise.
   */
  public find(document: vscode.TextDocument): PromiseLine[] {
    if (
      !isMarkdownFile(document.uri) ||
      !this.index.isNotesFile(document.uri) ||
      !readEditorToggle('trackPromises', document.uri)
    ) {
      return [];
    }
    const now = this.now();
    if (!isTodaysNote(document, now)) {
      return [];
    }
    return measure(
      'Promises',
      () => findOpenPromises(document, this.marks, now),
      (found) => `${found.length} promises, ${document.lineCount} lines`,
    );
  }

  /** Above each promise: Track, with the person and the day, and Not a promise. */
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const promises = this.find(document);
    if (promises.length === 0) {
      return [];
    }
    const index = this.index.getSnapshot();
    const now = this.now();
    return promises.flatMap((promise) => {
      const { name, day } = describePromise(promise, index, now);
      const range = new vscode.Range(promise.line, 0, promise.line, 0);
      const text = document.lineAt(promise.line).text;
      return [
        new vscode.CodeLens(range, {
          title: `Track: ${name} · ${day}`,
          tooltip: `Write a waiting task for ${name}, due ${day}, under this line`,
          command: TRACK_PROMISE_COMMAND,
          arguments: [document.uri.toString(), promise.line, text, false, promise.due],
        }),
        new vscode.CodeLens(range, {
          title: 'Not a promise',
          tooltip: 'Stop offering to track this line',
          command: NOT_A_PROMISE_COMMAND,
          arguments: [document.uri.toString(), text],
        }),
      ];
    });
  }

  /**
   * On a promise's line: Track, written at once as one edit; Track…, which
   * opens the task editor first; and Not a promise.
   */
  public provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    const promises = this.find(document).filter(
      (promise) => promise.line >= range.start.line && promise.line <= range.end.line,
    );
    if (promises.length === 0) {
      return [];
    }
    const index = this.index.getSnapshot();
    const now = this.now();
    return promises.flatMap((promise) => {
      const { name, day } = describePromise(promise, index, now);
      const text = document.lineAt(promise.line).text;
      const track = new vscode.CodeAction(`Track as waiting on ${name}, due ${day}`, vscode.CodeActionKind.QuickFix);
      track.edit = createPromiseEdit(document, promise.line, formatPromiseLine(document, promise));
      const trackInEditor = new vscode.CodeAction(`Track as waiting on ${name}…`, vscode.CodeActionKind.QuickFix);
      trackInEditor.command = {
        title: trackInEditor.title,
        command: TRACK_PROMISE_COMMAND,
        arguments: [document.uri.toString(), promise.line, text, true, promise.due],
      };
      const dismiss = new vscode.CodeAction('Not a promise', vscode.CodeActionKind.QuickFix);
      dismiss.command = {
        title: dismiss.title,
        command: NOT_A_PROMISE_COMMAND,
        arguments: [document.uri.toString(), text],
      };
      return [track, trackInEditor, dismiss];
    });
  }

  /** Underlines the day words of each promise in an editor, or nothing. */
  public draw(editor: vscode.TextEditor): void {
    editor.setDecorations(
      this.underlineType,
      this.find(editor.document).map(
        (promise) => new vscode.Range(promise.line, promise.start, promise.line, promise.end),
      ),
    );
  }

  /** Draws every visible editor again, and asks for the lenses again. */
  private redraw(): void {
    vscode.window.visibleTextEditors.forEach((editor) => this.draw(editor));
    this.changeEmitter.fire();
  }

  /** Draws a changed document's editors once typing pauses. */
  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.pending.schedule(key, () => {
      vscode.window.visibleTextEditors
        .filter((editor) => editor.document.uri.toString() === key)
        .forEach((editor) => this.draw(editor));
    });
  }
}
