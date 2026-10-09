import * as vscode from 'vscode';

import { isMarkdownFile } from '../../core/workspace/scanner';
import { onIndexUpdateInTurn, VIEW_PRIORITY } from '../../core/workspace/publishing';
import type { WorkspaceIndex } from '../../domain/model';
import { getTypeIndex } from '../../domain/types/typeIndex';
import { measure } from '../../shared/timing';
import { CREATE_TYPE_COMMAND, CREATE_TYPE_ROW_COMMAND } from '../commands/typeNotes';
import { describeTypeDiagnostics, TypeDiagnostic, TypeFix } from '../state/typeProblems';
import { readEditorToggle } from './editorToggles';

/** What the type marks read from the indexer. */
interface TypeHealthSource {
  readonly ready: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
}

/** How long typing must pause before a changed note's marks are placed again. */
const CHECK_DELAY_MS = 300;

/**
 * Marks what is wrong with typed notes in the open editors, as Information
 * (docs/implementation/30-databases.md § Surfaces 2): a field's value that
 * names nothing or does not fit its kind, a field a built-in's name takes,
 * two types defining one field differently, both sides of a relation
 * disagreeing, and what a type note gets wrong; and offers each one's
 * quick fixes. The marks follow the link marks' setting,
 * `deckard.editor.linkDiagnostics`, since a value that names no row is a
 * link that opens nothing.
 *
 * The problems are the index's; a note's marks are placed again on its
 * lines as they are typed, and a value no longer on its line loses its
 * mark until the note is read again.
 */
export class TypeHealth implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('deckard-types');
  private readonly disposables: vscode.Disposable[] = [this.diagnostics];
  /** Each open note's marks with their fixes, by document URI, for the quick fixes to read back. */
  private readonly marks = new Map<string, TypeDiagnostic[]>();
  private readonly pendingChecks = new Map<string, ReturnType<typeof setTimeout>>();
  private isReady = false;

  /** Marks open notes once the index is ready, and again as they or the index change. */
  public constructor(private readonly indexer: TypeHealthSource) {
    this.disposables.push(
      vscode.languages.registerCodeActionsProvider(
        { pattern: '**/*.md' },
        { provideCodeActions: (document, _range, context) => this.provideCodeActions(document, context) },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
      ),
      onIndexUpdateInTurn(indexer, { name: 'type checks', priority: () => VIEW_PRIORITY.visible }, () => this.checkOpenNotes()),
      vscode.workspace.onDidOpenTextDocument((document) => this.check(document)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.scheduleCheck(event.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        clearTimeout(this.pendingChecks.get(document.uri.toString()));
        this.clear(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.editor.linkDiagnostics') || event.affectsConfiguration('deckard.editor.preset')) {
          this.checkOpenNotes();
        }
      }),
    );
    void indexer.ready.then(() => {
      this.isReady = true;
      this.checkOpenNotes();
    });
  }

  /** Stops marking, and clears the marks and the checks still waiting. */
  public dispose(): void {
    this.pendingChecks.forEach((handle) => clearTimeout(handle));
    this.pendingChecks.clear();
    this.marks.clear();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Marks one note now, or clears it when it is not a note or the setting is off. */
  public check(document: vscode.TextDocument): void {
    if (
      !this.isReady ||
      !isMarkdownFile(document.uri) ||
      !this.indexer.isNotesFile(document.uri) ||
      !readEditorToggle('linkDiagnostics', document.uri)
    ) {
      this.clear(document.uri);
      return;
    }
    const index = this.indexer.getSnapshot();
    const types = getTypeIndex(index);
    if (types.isEmpty) {
      this.clear(document.uri);
      return;
    }
    const marks = measure(
      'Type diagnostics',
      () => describeTypeDiagnostics(types, index, this.indexer.getFilePath(document.uri), document.getText().split(/\r?\n/)),
      (found) => `${found.length} problems, ${document.lineCount} lines`,
    );
    this.marks.set(document.uri.toString(), marks);
    this.diagnostics.set(document.uri, marks.map(toDiagnostic));
  }

  /**
   * The quick fixes of the marks under the cursor: Change to a close row
   * or option, and Allow A or B, as edits; Create person "Omar H" and
   * Create a <Type> type, as commands that write a note.
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const marks = this.marks.get(document.uri.toString()) ?? [];
    return context.diagnostics
      .filter((diagnostic) => diagnostic.source === 'Deckard' && typeof diagnostic.code === 'string' && diagnostic.code.startsWith('type:'))
      .flatMap((diagnostic) => {
        const mark = marks.find(
          (candidate) =>
            candidate.line === diagnostic.range.start.line &&
            candidate.start === diagnostic.range.start.character &&
            `type:${candidate.code}` === diagnostic.code,
        );
        return (mark?.fixes ?? []).map((fix) => toCodeAction(document, diagnostic, fix));
      });
  }

  private clear(uri: vscode.Uri): void {
    this.marks.delete(uri.toString());
    this.diagnostics.delete(uri);
  }

  /** Marks every note open in an editor. */
  private checkOpenNotes(): void {
    vscode.workspace.textDocuments.forEach((document) => this.check(document));
  }

  /** Marks a note again once its typing has paused, replacing a check still waiting. */
  private scheduleCheck(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.pendingChecks.get(key));
    this.pendingChecks.set(
      key,
      setTimeout(() => {
        this.pendingChecks.delete(key);
        this.check(document);
      }, CHECK_DELAY_MS),
    );
  }
}

/** A mark as an Information diagnostic, its code saying which type problem it is. */
function toDiagnostic(mark: TypeDiagnostic): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(mark.line, mark.start, mark.line, Math.max(mark.end, mark.start)),
    mark.message,
    vscode.DiagnosticSeverity.Information,
  );
  diagnostic.source = 'Deckard';
  diagnostic.code = `type:${mark.code}`;
  return diagnostic;
}

/** A fix as a quick fix: an edit to the note, or a command that writes a new one. */
function toCodeAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, fix: TypeFix): vscode.CodeAction {
  const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  if (fix.kind === 'replace') {
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, new vscode.Range(fix.line, fix.start, fix.line, fix.end), fix.text);
    action.isPreferred = fix.preferred === true;
    return action;
  }
  action.command =
    fix.kind === 'create-row'
      ? { title: fix.title, command: CREATE_TYPE_ROW_COMMAND, arguments: [document.uri.toString(), fix.typeKey, fix.rowTitle] }
      : {
          title: fix.title,
          command: CREATE_TYPE_COMMAND,
          arguments: [document.uri.toString(), { key: fix.key, name: fix.name, rows: fix.rows }],
        };
  return action;
}
