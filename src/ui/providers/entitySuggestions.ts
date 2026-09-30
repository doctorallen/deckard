import * as vscode from 'vscode';

import { extractTags, getEntityKind } from '../../domain/markdown/parser';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { readEntityNamespaceAliases, readPersonMarker } from '../commands/parseSettings';

/**
 * Offers a quiet, reviewable entry point for headings that lack an entity tag.
 */
export class EntityHeadingSuggestions implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];

  /** Takes the notes test; nothing is registered until `register`. */
  public constructor(
    /** Whether a file is one of the notes; the offer is made only there. */
    private readonly isNotesFile: (uri: vscode.Uri) => boolean = () => true,
  ) {}

  /**
   * Registers the quick fix for Markdown files. Returns the provider, so the
   * composition root can build and register it in one expression.
   */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCodeActionsProvider(
        { pattern: '**/*.md' },
        {
          provideCodeActions: (document, range) =>
            this.provideCodeActions(document, range),
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
      ),
    );
    return this;
  }

  /** Unregisters the quick fix. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * Offers to tag a heading the cursor is on with an entity, when it carries
   * none yet; nothing on any other line or outside the notes.
   */
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
