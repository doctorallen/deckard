import * as vscode from 'vscode';

import {
  extractTags,
  getEntityKind,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../core/markdown/parser';
import { isMarkdownFile } from '../../core/workspace/scanner';

/**
 * Offers a quiet, reviewable entry point for headings that lack an entity tag.
 */
export class EntityHeadingSuggestions implements vscode.Disposable {
  private readonly registration: vscode.Disposable;

  public constructor() {
    this.registration = vscode.languages.registerCodeActionsProvider(
      { pattern: '**/*.md' },
      {
        provideCodeActions: (document, range) =>
          this.provideCodeActions(document, range),
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    );
  }

  public dispose(): void {
    this.registration.dispose();
  }

  private provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    if (!isMarkdownFile(document.uri)) {
      return [];
    }
    const line = document.lineAt(range.start.line).text;
    const aliases = getEntityNamespaceAliases(
      vscode.workspace
        .getConfiguration('deckard', document.uri)
        .get<unknown>('entityNamespaceAliases', {}),
    );
    const personMarker = getPersonMarker(
      vscode.workspace
        .getConfiguration('deckard', document.uri)
        .get<unknown>('personMarker', '@'),
    );
    if (
      !/^ {0,3}#{1,6}[ \t]+/.test(line) ||
      extractTags(line, aliases, personMarker).some((tag) =>
        getEntityKind(tag, aliases),
      )
    ) {
      return [];
    }

    const action = new vscode.CodeAction(
      'Link this heading to an entity',
      vscode.CodeActionKind.QuickFix,
    );
    action.command = {
      command: 'deckard.linkCurrentHeading',
      title: 'Deckard: Link Current Heading to Entity',
    };
    return [action];
  }
}
