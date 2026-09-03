import * as vscode from 'vscode';

import { extractTagSpans } from '../../core/markdown/parser';
import { isMarkdownFile } from '../../core/workspace/scanner';

/**
 * Keeps tag appearance and click behavior synchronized in visible editors.
 *
 * Decoration types provide the visual affordance but no click callback, so a
 * document-link provider supplies navigation over the same parsed ranges.
 */
export class EditorTagDecorations implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationType =
    vscode.window.createTextEditorDecorationType({
      border: '1px solid',
      borderColor: new vscode.ThemeColor('textLink.foreground'),
      borderRadius: '2px',
      cursor: 'pointer',
      textDecoration: 'none',
    });

  public constructor() {
    this.disposables.push(this.decorationType);
    this.disposables.push(
      vscode.languages.registerDocumentLinkProvider(
        { language: 'markdown' },
        {
          provideDocumentLinks: (document) =>
            this.provideDocumentLinks(document),
        },
      ),
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateEditor(editor);
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.parseInlineTags')) {
          vscode.window.visibleTextEditors.forEach((editor) =>
            this.updateEditor(editor),
          );
        }
      }),
    );
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        editors.forEach((editor) => this.updateEditor(editor));
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        vscode.window.visibleTextEditors
          .filter(
            (editor) =>
              editor.document.uri.toString() === event.document.uri.toString(),
          )
          .forEach((editor) => this.updateEditor(editor));
      }),
    );

    vscode.window.visibleTextEditors.forEach((editor) =>
      this.updateEditor(editor),
    );
  }

  /**
   * Releases the shared decoration type and every document/editor listener.
   */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Creates command links from the same ranges used for visual decoration.
   */
  private provideDocumentLinks(
    document: vscode.TextDocument,
  ): vscode.DocumentLink[] {
    if (!isMarkdownDocument(document)) {
      return [];
    }

    return extractTagSpans(
      document.getText(),
      this.parseInlineTags(document),
    ).map((span) => {
      const range = new vscode.Range(
        span.lineNumber - 1,
        span.startColumn,
        span.lineNumber - 1,
        span.endColumn,
      );
      const link = new vscode.DocumentLink(
        range,
        createTagOverviewUri(span.key),
      );
      link.tooltip = `Open ${span.label} tag overview`;
      return link;
    });
  }

  /**
   * Refreshes only the requested editor so edits do not disturb other views.
   */
  private updateEditor(editor: vscode.TextEditor): void {
    if (!isMarkdownDocument(editor.document)) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const decorations = extractTagSpans(
      editor.document.getText(),
      this.parseInlineTags(editor.document),
    ).map((span) => ({
      range: new vscode.Range(
        span.lineNumber - 1,
        span.startColumn,
        span.lineNumber - 1,
        span.endColumn,
      ),
      hoverMessage: `Open ${span.label} tag overview`,
    }));
    editor.setDecorations(this.decorationType, decorations);
  }

  /**
   * Reads the setting from the document's workspace scope for multi-root use.
   */
  private parseInlineTags(document: vscode.TextDocument): boolean {
    return vscode.workspace
      .getConfiguration('deckard', document.uri)
      .get<boolean>('parseInlineTags', true);
  }
}

/**
 * Uses the URI extension rather than language mode because users can associate
 * or edit a Markdown file with a different language identifier.
 */
export function isMarkdownDocument(
  document: Pick<vscode.TextDocument, 'languageId' | 'uri'>,
): boolean {
  return isMarkdownFile(document.uri);
}

/**
 * Encodes the tag key as a command argument without exposing raw user text in
 * the command URI.
 */
function createTagOverviewUri(tagKey: string): vscode.Uri {
  return vscode.Uri.parse(
    `command:deckard.showTagOverview?${encodeURIComponent(
      JSON.stringify([tagKey]),
    )}`,
  );
}
