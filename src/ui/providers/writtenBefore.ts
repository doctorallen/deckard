import * as vscode from 'vscode';

import { whenPublished } from '../../core/workspace/publishing';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { extractTags } from '../../domain/markdown/parser';
import type { ParsedFile, Section, WorkspaceIndex } from '../../domain/model';
import { findUnindexedLines } from '../../domain/ranking/lineIndex';
import {
  describeWrittenBeforeHint,
  findWrittenBefore,
  type FoundWrittenBefore,
  keepWrittenBefore,
  type WrittenBeforeMatch,
} from '../../domain/ranking/writtenBefore';
import { measure } from '../../shared/timing';
import { readDateFormats } from '../commands/datePrompt';
import { readZen } from '../commands/displaySettings';
import { describeWrittenBeforeHover, toWrittenBeforeRow, type WrittenBeforeRow } from '../state/writtenBeforeState';
import { onDidBuildLineIndex, readLineIndex } from '../state/lineIndexBuild';
import { readEditorToggle } from './editorToggles';

/**
 * You've written this before: as the reader writes a line of six words or
 * more and typing pauses for a second, the older lines of other notes like
 * it, said after the cursor's line, marked in the gutter beside the other
 * lines near it that have one, and listed in a hover with Open, Link it
 * here, and Not the same (docs/implementation/39-written-before.md).
 */

/** What the hints read from the indexer, and when they redraw. */
export interface WrittenBeforeIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
  parse(uri: vscode.Uri, content: string): ParsedFile;
}

/** The pairs set aside with Not the same, and when that changes. */
export interface WrittenBeforeRejections {
  rejected(): ReadonlySet<string>;
  readonly onDidChange: vscode.Event<void>;
}

/** The cursor's line and the older lines like it, which Context lists too. */
export interface CursorWrittenBefore {
  uri: vscode.Uri;
  /** Zero-based. */
  line: number;
  /** The line as it was when its matches were found. */
  text: string;
  rows: WrittenBeforeRow[];
}

/** How long typing or a cursor must rest before the line is compared. */
const PAUSE_MS = 1000;
/** How many lines around the cursor the gutter marks are worked out for. */
const GUTTER_LINES = 200;
/** How long one turn of working out gutter marks may run before it yields. */
const GUTTER_BUDGET_MS = 20;

/** A line of the active note that has older lines like it, as they were found. */
interface MarkedLine {
  /** The line's words when its matches were found; the hover is for those words only. */
  text: string;
  matches: WrittenBeforeMatch[];
}

/** The active note as the hints read it, once per version of it. */
interface ReadNote {
  uri: string;
  version: number;
  file: ParsedFile;
  /** The lines never compared: front matter, fenced code, and headings, as the line index leaves them out. */
  skipped: ReadonlySet<number>;
}

/** The command a hover's links run, with their arguments. */
function commandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

/**
 * The hint after the cursor's line, the gutter's marks, and the hover on
 * either, for the note in the active editor. Matches are worked out once
 * per line's words and index, so moving the cursor back costs nothing.
 */
export class WrittenBeforeHints implements vscode.HoverProvider, vscode.Disposable {
  private readonly hintType = vscode.window.createTextEditorDecorationType({});
  private readonly gutterType: vscode.TextEditorDecorationType;
  private readonly changeEmitter = new vscode.EventEmitter<CursorWrittenBefore | undefined>();
  /** Fires when the cursor's line, or what it is like, changes; Context listens. */
  public readonly onDidChangeCursor = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.hintType, this.changeEmitter];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Each line's matches, by its note and words, for the index and the pairs
   * set aside they were found in. A newer index keeps those its changed
   * notes cannot reach (`keepWrittenBefore`).
   */
  private found: { index?: WorkspaceIndex; rejected?: ReadonlySet<string>; byLine: Map<string, FoundWrittenBefore> } = { byLine: new Map() };
  /**
   * The lines of the active note that have matches, by line, for the
   * hover. Cleared when the note changes, since a line number then names
   * other words.
   */
  private marked = new Map<number, MarkedLine>();
  private markedUri: string | undefined;
  private isReady = false;
  /** The gutter's pass under way, which a newer one stops. */
  private gutterPass = 0;
  private cursor: CursorWrittenBefore | undefined;
  private note: ReadNote | undefined;

  /** Takes the index and the pairs set aside; nothing is drawn or registered until `register`. */
  public constructor(
    private readonly indexer: WrittenBeforeIndexSource,
    private readonly memory: WrittenBeforeRejections,
    extensionUri: vscode.Uri,
  ) {
    this.gutterType = vscode.window.createTextEditorDecorationType({
      light: { gutterIconPath: vscode.Uri.joinPath(extensionUri, 'resources', 'written-before-light.svg') },
      dark: { gutterIconPath: vscode.Uri.joinPath(extensionUri, 'resources', 'written-before-dark.svg') },
      gutterIconSize: 'contain',
    });
    this.disposables.push(this.gutterType);
  }

  /** The cursor's line and the older lines like it, while there are any. */
  public get current(): CursorWrittenBefore | undefined {
    return this.cursor;
  }

  /**
   * Listens to the cursor, typing, the active editor, the index, the
   * settings, and Not the same, and registers the hover. Returns the hints,
   * so the composition root can build and register them in one expression.
   */
  public register(): this {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length === 0 || event.document !== vscode.window.activeTextEditor?.document) {
          return;
        }
        this.clearHint();
        this.clearMarks();
        this.schedule();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.clearAll();
        this.schedule();
      }),
      this.indexer.onDidUpdate(() => this.schedule()),
      // Nothing is shown while the line index is first built; then the hint is.
      onDidBuildLineIndex(() => this.update()),
      this.memory.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.editor') || event.affectsConfiguration('deckard.display')) {
          this.update();
        } else if (event.affectsConfiguration('deckard')) {
          // How a note is read may have changed with it.
          this.note = undefined;
        }
      }),
      vscode.languages.registerHoverProvider({ pattern: '**/*.md' }, this),
    );
    void whenPublished(this.indexer).then(() => {
      this.isReady = true;
      this.schedule();
    });
    return this;
  }

  /** Stops listening, and takes the hint and the marks away. */
  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.gutterPass += 1;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** The hover on a line that has older lines like it: the cursor's, or one the gutter marks. */
  public provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (document.uri.toString() !== this.markedUri) {
      return undefined;
    }
    const marked = position.line < document.lineCount ? this.marked.get(position.line) : undefined;
    const lineText = marked ? document.lineAt(position.line).text : undefined;
    // The matches are for the words the line had when they were found; a
    // line that reads otherwise now, or another line at that number, has
    // none, so Link it here never reaches words it was not found for.
    if (!marked || marked.matches.length === 0 || lineText !== marked.text) {
      return undefined;
    }
    const { matches } = marked;
    const index = this.indexer.getSnapshot();
    const rows = matches.map((match) => toWrittenBeforeRow(index, match, { now: Date.now(), dateFormats: readDateFormats() }));
    const markdown = new vscode.MarkdownString(
      describeWrittenBeforeHover(rows, (row) => ({
        open: commandUri('deckard.openNote', [row.filePath, row.line]),
        linkHere: commandUri('deckard.writtenBefore.linkHere', [
          { documentUri: document.uri.toString(), line: position.line, lineText, filePath: row.filePath, targetLine: row.line },
        ]),
        notSame: commandUri('deckard.writtenBefore.notSame', [lineText, row.text]),
      })),
    );
    markdown.isTrusted = { enabledCommands: ['deckard.openNote', 'deckard.writtenBefore.linkHere', 'deckard.writtenBefore.notSame'] };
    return new vscode.Hover(markdown, document.lineAt(position.line).range);
  }

  /** Works the cursor's line out again once the cursor and typing have rested. */
  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.update();
    }, PAUSE_MS);
  }

  /**
   * The hint for the cursor's line, then the gutter's marks around it, in
   * the active editor, while `deckard.editor.writtenBefore` is on for it.
   */
  public update(): void {
    const editor = vscode.window.activeTextEditor;
    if (
      !this.isReady ||
      !editor ||
      !isMarkdownFile(editor.document.uri) ||
      !this.indexer.isNotesFile(editor.document.uri) ||
      !readEditorToggle('writtenBefore', editor.document.uri)
    ) {
      this.clearAll();
      return;
    }
    // While the line index is first built, nothing is compared or shown.
    if (!readLineIndex(this.indexer.getSnapshot())) {
      this.clearAll();
      return;
    }
    const document = editor.document;
    const note = this.readNote(document);
    const line = editor.selection.active.line;
    const text = document.lineAt(line).text;
    const matches = note.skipped.has(line)
      ? []
      : measure(
          'Written before',
          () => this.matchesFor(note.file, line, text),
          (found) => `${found.length} matches`,
        );
    this.markedUri = document.uri.toString();
    this.marked = new Map(matches.length ? [[line, { text, matches }]] : []);
    this.drawHint(editor, line, matches);
    this.setCursor(matches.length ? { uri: document.uri, line, text, rows: this.toRows(matches) } : undefined);
    this.markGutter(editor, note, line);
  }

  /**
   * The note as the hints read it: the index's own reading while the note
   * reads as the index read it, else a reading of the editor's text, made
   * once per version of the document, so a cursor that only moves reads
   * nothing again.
   */
  private readNote(document: vscode.TextDocument): ReadNote {
    const uri = document.uri.toString();
    if (this.note?.uri === uri && this.note.version === document.version) {
      return this.note;
    }
    const text = document.getText();
    const indexed = this.indexer.getSnapshot().files.get(this.indexer.getFilePath(document.uri));
    const file = indexed?.content === text ? indexed : this.indexer.parse(document.uri, text);
    this.note = { uri, version: document.version, file, skipped: findUnindexedLines(text.split(/\r?\n/)) };
    return this.note;
  }

  /** The older lines like a line of the note, worked out once per index, pairs set aside, and line. */
  private matchesFor(file: ParsedFile, line: number, text: string): WrittenBeforeMatch[] {
    const index = this.indexer.getSnapshot();
    const rejected = this.memory.rejected();
    // A newer index a gutter pass meets is not ranked against until its
    // lines are ready, which could take a rebuild after a settings change.
    if (!readLineIndex(index)) {
      return [];
    }
    if (this.found.rejected !== rejected || !this.found.index) {
      this.found = { index, rejected, byLine: new Map() };
    } else if (this.found.index !== index) {
      this.found = { index, rejected, byLine: keepWrittenBefore(this.found.index, index, this.found.byLine) };
    }
    const key = `${file.filePath}\u0000${text}`;
    let found = this.found.byLine.get(key);
    if (!found) {
      const matches = findWrittenBefore(index, { text, filePath: file.filePath, tags: lineTags(file, line, text) }, { now: Date.now(), rejected });
      found = { filePath: file.filePath, text, matches };
      this.found.byLine.set(key, found);
    }
    return found.matches;
  }

  /** The hint after the cursor's line: the first older line, its day, and its words, or `↺` alone under Zen. */
  private drawHint(editor: vscode.TextEditor, line: number, matches: readonly WrittenBeforeMatch[]): void {
    const [first] = matches;
    if (!first) {
      editor.setDecorations(this.hintType, []);
      return;
    }
    const row = toWrittenBeforeRow(this.indexer.getSnapshot(), first, { now: Date.now(), dateFormats: readDateFormats() });
    const end = editor.document.lineAt(line).range.end;
    editor.setDecorations(this.hintType, [
      {
        range: new vscode.Range(end, end),
        renderOptions: {
          after: {
            contentText: describeWrittenBeforeHint(row, row.day, readZen()),
            color: new vscode.ThemeColor('deckard.writtenBeforeForeground'),
            fontStyle: 'italic',
            margin: '0 0 0 1.5em',
          },
        },
      },
    ]);
  }

  /**
   * Marks in the gutter the other lines near the cursor that have older
   * lines like them: at most the 200 nearest, nearest first, a few at a
   * time, so a long note never holds the editor up.
   */
  private markGutter(editor: vscode.TextEditor, note: ReadNote, cursor: number): void {
    const pass = (this.gutterPass += 1);
    const document = editor.document;
    const order = nearestLines(cursor, document.lineCount, GUTTER_LINES).filter((line) => line !== cursor && !note.skipped.has(line));
    const marks: vscode.Range[] = [];
    const step = (from: number): void => {
      if (pass !== this.gutterPass || document.isClosed) {
        return;
      }
      const started = Date.now();
      let at = from;
      for (; at < order.length && Date.now() - started < GUTTER_BUDGET_MS; at += 1) {
        const line = order[at];
        // An edit stops the pass, but a line the note no longer has is
        // never read, whatever the order of events.
        if (line >= document.lineCount) {
          continue;
        }
        const text = document.lineAt(line).text;
        const matches = this.matchesFor(note.file, line, text);
        if (matches.length > 0) {
          this.marked.set(line, { text, matches });
          marks.push(new vscode.Range(line, 0, line, 0));
        }
      }
      editor.setDecorations(this.gutterType, marks);
      if (at < order.length) {
        setTimeout(() => step(at), 0);
      }
    };
    step(0);
  }

  /** Older lines as rows, read from the index now. */
  private toRows(matches: readonly WrittenBeforeMatch[]): WrittenBeforeRow[] {
    const index = this.indexer.getSnapshot();
    const options = { now: Date.now(), dateFormats: readDateFormats() };
    return matches.map((match) => toWrittenBeforeRow(index, match, options));
  }

  /** Takes the hint away while a line is being typed. */
  private clearHint(): void {
    vscode.window.activeTextEditor?.setDecorations(this.hintType, []);
    this.setCursor(undefined);
  }

  /**
   * Takes the gutter's marks away from the active editor and stops the pass
   * drawing them, as an edit does: its line numbers name other lines now.
   */
  private clearMarks(): void {
    this.gutterPass += 1;
    this.marked = new Map();
    vscode.window.activeTextEditor?.setDecorations(this.gutterType, []);
  }

  /** Takes the hint and the marks away from every visible editor. */
  private clearAll(): void {
    this.gutterPass += 1;
    this.marked = new Map();
    this.markedUri = undefined;
    vscode.window.visibleTextEditors.forEach((editor) => {
      editor.setDecorations(this.hintType, []);
      editor.setDecorations(this.gutterType, []);
    });
    this.setCursor(undefined);
  }

  /** Keeps the cursor's matches, telling Context when they change. */
  private setCursor(next: CursorWrittenBefore | undefined): void {
    const same =
      next?.uri.toString() === this.cursor?.uri.toString() &&
      next?.line === this.cursor?.line &&
      JSON.stringify(next?.rows) === JSON.stringify(this.cursor?.rows);
    this.cursor = next;
    if (!same) {
      this.changeEmitter.fire(next);
    }
  }
}

/**
 * The tags a line carries, as a match's are compared with: its own, and
 * those of the entry it is written in, a tagged line's or a heading's.
 */
function lineTags(file: ParsedFile, line: number, text: string): string[] {
  const own = extractTags(text).map((tag) => tag.key);
  const section = findSection(file.sections, line + 1);
  return [...own, ...(section?.tags ?? [])];
}

/** The entry a one-based line is written in: the latest to start at or above it that runs past it. */
function findSection(sections: readonly Section[], line: number): Section | undefined {
  return sections
    .filter((section) => section.startLine <= line && section.endLine >= line)
    .sort((left, right) => right.startLine - left.startLine)[0];
}

/** Up to `limit` lines of a note around `cursor`, nearest first. */
export function nearestLines(cursor: number, lineCount: number, limit: number): number[] {
  const lines: number[] = [];
  for (let distance = 0; lines.length < limit && (cursor - distance >= 0 || cursor + distance < lineCount); distance += 1) {
    if (cursor - distance >= 0) {
      lines.push(cursor - distance);
    }
    if (distance > 0 && cursor + distance < lineCount && lines.length < limit) {
      lines.push(cursor + distance);
    }
  }
  return lines;
}
