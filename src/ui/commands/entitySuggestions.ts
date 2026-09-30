import * as vscode from 'vscode';

import { extractTags, getEntityKind } from '../../core/markdown/parser';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { readEntityNamespaceAliases, readPersonMarker } from './parseSettings';

/**
 * Offers a quiet, reviewable entry point for headings that lack an entity tag.
 */
export class EntityHeadingSuggestions implements vscode.Disposable {
  private readonly registration: vscode.Disposable;

  public constructor(
    /** Whether a file is one of the notes; the offer is made only there. */
    private readonly isNotesFile: (uri: vscode.Uri) => boolean = () => true,
  ) {
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
    if (!isMarkdownFile(document.uri) || !this.isNotesFile(document.uri)) {
      return [];
    }
    const line = document.lineAt(range.start.line).text;
    const aliases = readEntityNamespaceAliases(document.uri);
    const personMarker = readPersonMarker(document.uri);
    if (
      !/^ {0,3}#{1,6}[ \t]+/.test(line) ||
      extractTags(line, aliases, personMarker).some((tag) =>
        getEntityKind(tag, aliases),
      )
    ) {
      return [];
    }

    const action = new vscode.CodeAction(
      'Tag this heading with a person or project…',
      vscode.CodeActionKind.QuickFix,
    );
    action.command = {
      command: 'deckard.linkCurrentHeading',
      title: 'Deckard: Link Current Heading to Entity',
    };
    return [action];
  }
}
