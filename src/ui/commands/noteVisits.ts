import * as vscode from 'vscode';

import { PreferenceServices } from '../../core/storage/preferences';
import { ParsedFile, Section, WorkspaceIndex } from '../../domain/model';

/** What NoteVisits reads from the index: the notes it may count and the headings in them. */
export interface NoteVisitSource {
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
}

/** The timings, clock, and editor events NoteVisits runs on; a test gives its own. */
export interface NoteVisitOptions {
  /** How long a note must stay active to count. */
  dwellMs?: number;
  /** How long before the same heading counts again. */
  repeatMs?: number;
  /** The clock a visit is stamped with. */
  now?: () => number;
  /** The editor events it follows; VS Code's own unless a test gives its own. */
  window?: NoteVisitWindow;
}

/** The part of `vscode.window` NoteVisits listens to, so a test can stand in for it. */
export type NoteVisitWindow = Pick<
  typeof vscode.window,
  'onDidChangeActiveTextEditor' | 'onDidChangeWindowState' | 'activeTextEditor' | 'state'
>;

/**
 * A note counts as opened when it stays open, however it was opened.
 *
 * Recently opened, Find, and `[[` completion rank notes by how often and how
 * lately they were opened, but only a note opened from one of Deckard's own
 * pages was counted: one opened from the Explorer, Quick Open, or a link was
 * not. This watches the editor instead. A note that stays the active editor
 * of a focused window for a moment counts once for the heading the cursor is
 * in, and again only after ten minutes, so flipping between two tabs is not
 * a dozen visits.
 */
export class NoteVisits implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly dwellMs: number;
  private readonly repeatMs: number;
  private readonly now: () => number;
  private readonly window: NoteVisitWindow;

  /** Starts watching at once, and counts the editor already active if it stays. */
  public constructor(
    private readonly indexer: NoteVisitSource,
    private readonly preferences: Pick<PreferenceServices, 'reader' | 'usage'>,
    options: NoteVisitOptions = {},
  ) {
    this.dwellMs = options.dwellMs ?? 1500;
    this.repeatMs = options.repeatMs ?? 10 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.window = options.window ?? vscode.window;
    this.disposables.push(
      this.window.onDidChangeActiveTextEditor((editor) => this.start(editor)),
      this.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.start(this.window.activeTextEditor);
        } else {
          this.cancel();
        }
      }),
    );
    this.start(this.window.activeTextEditor);
  }

  /** Stops watching; a visit still waiting out its dwell is not counted. */
  public dispose(): void {
    this.cancel();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Drops the visit waiting out its dwell, if there is one. */
  private cancel(): void {
    if (this.timer === undefined) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Waits out the dwell for a note in this editor, then counts it if it is
   * still the active editor of a focused window. Anything that is not a note
   * file only cancels the wait.
   */
  private start(editor: vscode.TextEditor | undefined): void {
    this.cancel();
    const document = editor?.document;
    if (!document || document.uri.scheme !== 'file' || !this.indexer.isNotesFile(document.uri)) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const active = this.window.activeTextEditor;
      if (active?.document !== document || this.window.state?.focused === false) {
        return;
      }
      void this.record(document.uri, active.selection.active.line + 1);
    }, this.dwellMs);
  }

  /** Counts a visit to the heading at this line, unless that heading was counted within repeatMs. */
  private async record(uri: vscode.Uri, line: number): Promise<void> {
    const file = this.indexer.getSnapshot().files.get(this.indexer.getFilePath(uri));
    const section = file ? sectionForVisit(file, line) : undefined;
    if (!section) {
      return;
    }
    const now = this.now();
    const last = this.preferences.reader.value.sectionAccessTimes?.[section.id];
    // A heading opened from Find a moment ago was counted then.
    if (last !== undefined && now - last < this.repeatMs) {
      return;
    }
    await this.preferences.usage.recordSectionAccess(section.id, now, { quiet: true });
  }
}

/**
 * The heading a visit counts for: the innermost one the cursor is in, or,
 * above every heading (as a note opened fresh is, on its front matter), the
 * note's first. A note without headings has none.
 */
export function sectionForVisit(
  file: Pick<ParsedFile, 'sections'>,
  line: number,
): Section | undefined {
  const headings = file.sections
    .filter((section) => !section.isInline)
    .sort((left, right) => left.startLine - right.startLine);
  const within = headings
    .filter((section) => section.startLine <= line && section.endLine >= line)
    .sort((left, right) => right.startLine - left.startLine)[0];
  return within ?? headings[0];
}
