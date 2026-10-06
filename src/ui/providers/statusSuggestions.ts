import * as vscode from 'vscode';

import { isMarkdownFile } from '../../core/workspace/scanner';
import { findFencedLines } from '../../domain/markdown/lineShapes';
import type { TaskStatusDefinition } from '../../domain/tasks/taskStatuses';
import { readTaskStatusOptions } from '../commands/parseSettings';

/** A list item's bullet and the `[` of a box just typed, which the statuses complete. */
const OPENED_BOX = /^\s*[-*+][ \t]+\[$/;

/** What the completion for one status says: its character and name, and what it means. */
export interface StatusCompletion {
  /** What replaces the box's inside: the character and the `] ` after it. */
  insert: string;
  label: string;
  detail: string;
}

/** What each type of status means, beside its name. */
const TYPE_WORDS: Readonly<Record<TaskStatusDefinition['type'], string>> = {
  todo: 'to do',
  inProgress: 'in progress',
  onHold: 'on hold',
  done: 'done',
  cancelled: 'cancelled',
  nonTask: 'not a task',
};

/**
 * The statuses a box just opened offers, in the order the settings list
 * them: each one with a character, as `[/] In progress`, a character given
 * twice offered once.
 */
export function listStatusCompletions(statuses: readonly TaskStatusDefinition[]): StatusCompletion[] {
  const seen = new Set<string>();
  return statuses.flatMap((status) => {
    if (status.symbol === undefined || seen.has(status.symbol)) {
      return [];
    }
    seen.add(status.symbol);
    return [{ insert: `${status.symbol}] `, label: `[${status.symbol}] ${status.name}`, detail: TYPE_WORDS[status.type] }];
  });
}

/**
 * Completes a task's box: typing `- [` offers every status's character,
 * In progress, Cancelled, Blocked, and a workspace's own, so a task is
 * written in the status it is in. The slash menu's task stays `[ ]`.
 */
export class StatusSuggestionsProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];

  /** Takes the notes test; nothing is registered until `register`. */
  public constructor(private readonly isNotesFile: (uri: vscode.Uri) => boolean) {}

  /** Registers the completions for Markdown files, after `[`, and returns the provider. */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCompletionItemProvider(
        { pattern: '**/*.md' },
        { provideCompletionItems: (document, position) => this.provideCompletionItems(document, position) },
        '[',
      ),
    );
    return this;
  }

  /** Unregisters the completions. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /** The statuses, after a list item's `[`, outside fenced code. */
  public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (!isMarkdownFile(document.uri) || !this.isNotesFile(document.uri)) {
      return [];
    }
    const line = document.lineAt(position.line).text;
    if (!OPENED_BOX.test(line.slice(0, position.character))) {
      return [];
    }
    if (findFencedLines(document.getText().split(/\r?\n/)).has(position.line)) {
      return [];
    }
    // An editor that closes brackets has written the `]` already; the
    // status takes its place, so the line has one.
    const closing = line.slice(position.character).match(/^\]?[ \t]?/)?.[0].length ?? 0;
    const range = new vscode.Range(position.line, position.character, position.line, position.character + closing);
    return listStatusCompletions(readTaskStatusOptions(document.uri)).map((status, order) => {
      const item = new vscode.CompletionItem(status.label, vscode.CompletionItemKind.EnumMember);
      item.insertText = status.insert;
      item.range = range;
      item.detail = status.detail;
      item.filterText = status.label;
      item.sortText = String(order).padStart(3, '0');
      return item;
    });
  }
}
