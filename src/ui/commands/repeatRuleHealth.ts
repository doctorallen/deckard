import * as vscode from 'vscode';

import { findFencedLines } from '../../core/markdown/parser';
import {
  findTaskMetadataSpans,
  parseRecurrence,
  suggestRecurrence,
} from '../../core/markdown/taskMetadata';
import { measure } from '../../core/timing';

/** An open task's repeat rule Deckard cannot read. */
export interface RepeatRuleProblem {
  /** Zero-based line, and the columns of the rule's own text. */
  line: number;
  start: number;
  end: number;
  rule: string;
  suggestions: string[];
}

const OPEN_TASK = /^(\s*[-*+][ \t]+\[ \][ \t]?)/;
const UNREADABLE_REPEAT = 'unreadable-repeat';
const CHECK_DELAY_MS = 300;

/**
 * The repeat rules on a note's open tasks that Deckard cannot read, each
 * with the nearest rules it can. Completing such a task would drop the
 * repeat without a word, so the rule is worth marking before then. Code and
 * front matter are left alone, and so are done tasks, which repeat no more.
 */
export function findRepeatRuleProblems(lines: readonly string[]): RepeatRuleProblem[] {
  const fenced = findFencedLines([...lines]);
  let skip = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, at) => at > 0 && /^(---|\.\.\.)\s*$/.test(line));
    skip = end > 0 ? end + 1 : 0;
  }
  const problems: RepeatRuleProblem[] = [];
  lines.forEach((text, line) => {
    const task = OPEN_TASK.exec(text);
    if (!task || line < skip || fenced.has(line)) {
      return;
    }
    const offset = task[1].length;
    const body = text.slice(offset);
    for (const span of findTaskMetadataSpans(body)) {
      if (span.field !== 'repeat' || !span.value || parseRecurrence(span.value)) {
        continue;
      }
      const written = body.slice(span.start, span.end);
      const start = offset + span.start + written.lastIndexOf(span.value);
      problems.push({
        line,
        start,
        end: start + span.value.length,
        rule: span.value,
        suggestions: suggestRecurrence(span.value),
      });
    }
  });
  return problems;
}

/** What the diagnostic says, with the nearest rule or an example of one. */
export function describeRepeatRuleProblem(problem: Pick<RepeatRuleProblem, 'rule' | 'suggestions'>): string {
  const lead = `Deckard cannot read the repeat rule "${problem.rule}", so completing this task will not start the next one.`;
  return problem.suggestions.length > 0
    ? `${lead} Try "${problem.suggestions[0]}".`
    : `${lead} Write a rule such as "every week", "every month on the 15th", or "every weekday".`;
}

/**
 * Marks an open task's repeat rule that Deckard cannot read, as a warning,
 * with quick fixes that change it to the nearest rules it can.
 */
export class RepeatRuleHealth implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('deckard-tasks');
  private readonly disposables: vscode.Disposable[] = [this.diagnostics];
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each diagnostic's suggestions, so the quick fix need not work them out again. */
  private readonly suggestions = new WeakMap<vscode.Diagnostic, string[]>();

  public constructor(private readonly isNotesFile: (uri: vscode.Uri) => boolean) {
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
        clearTimeout(this.pending.get(document.uri.toString()));
        this.diagnostics.delete(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.editor.repeatDiagnostics') ||
          event.affectsConfiguration('deckard.notesFolder') ||
          event.affectsConfiguration('deckard.exclude')
        ) {
          this.checkOpen();
        }
      }),
    );
    this.checkOpen();
  }

  public dispose(): void {
    this.pending.forEach((handle) => clearTimeout(handle));
    this.pending.clear();
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
      !vscode.workspace.getConfiguration('deckard', document.uri).get<boolean>('editor.repeatDiagnostics', true)
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

  private checkOpen(): void {
    vscode.workspace.textDocuments.forEach((document) => this.check(document));
  }

  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        this.check(document);
      }, CHECK_DELAY_MS),
    );
  }
}
