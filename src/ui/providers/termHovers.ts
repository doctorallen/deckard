import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../domain/model';
import { findTermSpans, forEachTermLine, getTermTable, type TermEntry } from '../../domain/terms/terms';
import { KeyedDebouncer } from '../../shared/debounce';
import { measure } from '../../shared/timing';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { readDateFormats } from '../commands/datePrompt';
import { readZen } from '../commands/displaySettings';
import { describeTermHover, MAKE_TERM_NOTE_COMMAND } from '../state/termHover';
import { readEditorToggle } from './editorToggles';

/** How long typing must pause before a changed note's underlines are drawn again. */
const DRAW_DELAY_MS = 300;

/** What the hovers and underlines read from the index. */
export interface TermIndexSource {
  getSnapshot(): WorkspaceIndex;
  isNotesFile(uri: vscode.Uri): boolean;
  readonly onDidUpdate: vscode.Event<unknown>;
}

/** A term written in a note, by its 0-based line and columns. */
interface WrittenTerm {
  term: string;
  line: number;
  start: number;
  end: number;
}

/** A note's terms, for one version of it. */
interface DocumentTerms {
  version: number;
  terms: WrittenTerm[];
}

/**
 * Terms in the editor (docs/implementation/42-terms.md): hovering a
 * defined term anywhere in a note says what it means, where it was
 * defined, and offers Open definition, Find uses, and Make a term note;
 * and, with `deckard.editor.termUnderline` on and Zen off, each defined
 * term has a faint dotted underline. Nothing in code, front matter, or a
 * file outside the notes.
 */
export class TermHovers implements vscode.HoverProvider, vscode.Disposable {
  private readonly pending = new KeyedDebouncer(DRAW_DELAY_MS);
  private readonly underlineType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline dotted var(--vscode-deckard-termUnderline)',
  });
  /** The decoration type, then every listener `register` adds. */
  private readonly disposables: vscode.Disposable[] = [this.underlineType];
  /** Each open note's terms, read once per version. */
  private readonly cache = new Map<string, DocumentTerms>();

  /** Takes the index; nothing is drawn or registered until `register`. */
  public constructor(private readonly index: TermIndexSource) {}

  /**
   * Registers the hover for Markdown files, listens to the editors, the
   * index, and the settings, and draws every visible editor. Returns the
   * provider, so the composition root can build and register it in one
   * expression.
   */
  public register(): this {
    this.disposables.push(
      vscode.languages.registerHoverProvider([{ language: 'markdown' }, { pattern: '**/*.md' }], this),
      this.index.onDidUpdate(() => this.redraw()),
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
      vscode.workspace.onDidCloseTextDocument((document) => this.cache.delete(document.uri.toString())),
    );
    this.redraw();
    return this;
  }

  /** Clears pending draws, the underlines, and every listener. */
  public dispose(): void {
    this.pending.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** The hover of the defined term under the pointer, or none. */
  public provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const written = this.read(document).find(
      (term) => term.line === position.line && term.start <= position.character && position.character < term.end,
    );
    const entry = written && getTermTable(this.index.getSnapshot()).terms.get(written.term);
    const hover = entry && describeTermHover(entry, Date.now(), readDateFormats());
    if (!written || !hover) {
      return undefined;
    }
    const links = hover.links.map((link) => `[${link.title}](command:${link.command}?${encodeURIComponent(JSON.stringify(link.arguments))})`);
    const markdown = new vscode.MarkdownString([hover.title, hover.source, links.join(' · ')].join('\n\n'));
    markdown.isTrusted = { enabledCommands: ['deckard.openNote', 'deckard.search', MAKE_TERM_NOTE_COMMAND] };
    return new vscode.Hover(markdown, new vscode.Range(written.line, written.start, written.line, written.end));
  }

  /** Underlines each defined term in an editor, when the setting is on and Zen is off. */
  public draw(editor: vscode.TextEditor): void {
    const { document } = editor;
    if (!readEditorToggle('termUnderline', document.uri) || readZen()) {
      editor.setDecorations(this.underlineType, []);
      return;
    }
    // A file that is no note, or a note with no term in it, needs no table.
    const written = this.read(document);
    if (written.length === 0) {
      editor.setDecorations(this.underlineType, []);
      return;
    }
    const { terms } = getTermTable(this.index.getSnapshot());
    editor.setDecorations(
      this.underlineType,
      written
        .filter((term) => isDefined(terms.get(term.term)))
        .map((term) => new vscode.Range(term.line, term.start, term.line, term.end)),
    );
  }

  /** The terms written in a note, read again only when it changed; none in a file that is no note. */
  private read(document: vscode.TextDocument): WrittenTerm[] {
    if (!isMarkdownFile(document.uri) || !this.index.isNotesFile(document.uri)) {
      return [];
    }
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached?.version === document.version) {
      return cached.terms;
    }
    const terms = measure(
      'Terms in a note',
      () => {
        const found: WrittenTerm[] = [];
        forEachTermLine(document.getText(), (text, line) => {
          findTermSpans(text).forEach((span) => found.push({ ...span, line: line - 1 }));
        });
        return found;
      },
      (found) => `${found.length} terms, ${document.lineCount} lines`,
    );
    this.cache.set(key, { version: document.version, terms });
    return terms;
  }

  /** Draws every visible editor again. */
  private redraw(): void {
    vscode.window.visibleTextEditors.forEach((editor) => this.draw(editor));
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

/** Whether a term has a definition, which is what is underlined and hovered. */
function isDefined(entry: TermEntry | undefined): boolean {
  return entry?.definition !== undefined;
}
