import * as vscode from 'vscode';

import { readEditorToggle } from './editorToggles';
import { KeyedDebouncer } from '../../shared/debounce';
import {
  describeRepeatRuleProblem,
  findRepeatRuleProblems,
} from '../../domain/markdown/repeatRuleProblems';
import { measure } from '../../shared/timing';
import { suggestRecurrence } from '../../domain/markdown/recurrence';

/** The code a diagnostic carries, which its quick fixes look for. */
const UNREADABLE_REPEAT = 'unreadable-repeat';
/** How long typing must pause before a changed note is checked again. */
const CHECK_DELAY_MS = 300;
/** The settings a change to which checks every open document again. */
const RECHECK_SETTINGS = [
  'deckard.editor.repeatDiagnostics',
  'deckard.notesFolder',
  'deckard.exclude',
];

/**
 * Marks an open task's repeat rule that Deckard cannot read, as a warning,
 * with quick fixes that change it to the nearest rules it can.
 */
export class RepeatRuleHealth implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('deckard-tasks');
  /** The diagnostic collection, then every listener `register` adds. */
  private readonly disposables: vscode.Disposable[] = [this.diagnostics];
  private readonly pending = new KeyedDebouncer(CHECK_DELAY_MS);
  /** Each diagnostic's suggestions, so the quick fix need not work them out again. */
  private readonly suggestions = new WeakMap<vscode.Diagnostic, string[]>();

  /**
   * Takes the notes test; nothing is checked or registered until `register`.
   */
  public constructor(private readonly isNotesFile: (uri: vscode.Uri) => boolean) {}

  /**
   * Registers the quick fixes for Markdown files, listens to the documents
   * and settings it checks on, and checks every open document. Returns the
   * checker, so the composition root can build and register it in one
   * expression.
   */
  public register(): this {
    this.disposables.push(
      vscode.languages.registerCodeActionsProvider(
        { pattern: '**/*.md' },
        { provideCodeActions: (document, _range, context) => this.provideCodeActions(document, context) },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
      ),
      vscode.workspace.onDidOpenTextDocument((document) => this.check(document)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.schedule(event.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.pending.cancel(document.uri.toString());
        this.diagnostics.delete(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (RECHECK_SETTINGS.some((section) => event.affectsConfiguration(section))) {
          this.checkOpen();
        }
      }),
    );
    this.checkOpen();
    return this;
  }

  /** Clears pending checks, the diagnostics, and every listener. */
  public dispose(): void {
    this.pending.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** The diagnostics set on a document, for a test to read. */
  public read(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  /** Checks one note now, or clears it when it is not a note or is turned off. */
  public check(document: vscode.TextDocument): void {
    if (
      !this.isNotesFile(document.uri) ||
      !readEditorToggle('repeatDiagnostics', document.uri)
    ) {
      this.diagnostics.delete(document.uri);
      return;
    }
    const problems = measure(
      'Repeat rule diagnostics',
      () => findRepeatRuleProblems(document.getText().split(/\r?\n/)),
      (found) => `${found.length} problems, ${document.lineCount} lines`,
    );
    this.diagnostics.set(
      document.uri,
      problems.map((problem) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(problem.line, problem.start, problem.line, problem.end),
          describeRepeatRuleProblem(problem),
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'Deckard';
        diagnostic.code = UNREADABLE_REPEAT;
        this.suggestions.set(diagnostic, problem.suggestions);
        return diagnostic;
      }),
    );
  }

  /** Up to three fixes, each changing only the rule's text. */
  public provideCodeActions(
    document: vscode.TextDocument,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    return context.diagnostics
      .filter((diagnostic) => diagnostic.source === 'Deckard' && diagnostic.code === UNREADABLE_REPEAT)
      .flatMap((diagnostic) => {
        const suggestions =
          this.suggestions.get(diagnostic) ?? suggestRecurrence(document.getText(diagnostic.range));
        return suggestions.map((rule, at) => {
          const action = new vscode.CodeAction(`Change the rule to "${rule}"`, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [diagnostic];
          action.isPreferred = at === 0;
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, diagnostic.range, rule);
          return action;
        });
      });
  }

  /** Checks every document VS Code has open. */
  private checkOpen(): void {
    vscode.workspace.textDocuments.forEach((document) => this.check(document));
  }

  /** Checks a changed document again once typing pauses. */
  private schedule(document: vscode.TextDocument): void {
    this.pending.schedule(document.uri.toString(), () => this.check(document));
  }
}
