import * as vscode from 'vscode';

import {
  extractTagSpans,
  getEntityNamespaceAliases,
  getPersonMarker,
  parseMarkdown,
} from '../../core/markdown/parser';
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
  private readonly noteDecorationType =
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(255, 255, 255, 0.025)',
      border: '0 0 0 1px solid',
      borderColor: 'rgba(255, 255, 255, 0.18)',
    });

  public constructor() {
    this.disposables.push(this.decorationType);
    this.disposables.push(this.noteDecorationType);
    this.disposables.push(
      vscode.languages.registerDocumentLinkProvider(
        markdownDocumentSelector,
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
        if (
          event.affectsConfiguration('deckard.parseInlineTags') ||
          event.affectsConfiguration('deckard.highlightNoteSections') ||
          event.affectsConfiguration('deckard.entityNamespaceAliases') ||
          event.affectsConfiguration('deckard.personMarker')
        ) {
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
      this.entityNamespaceAliases(document),
      this.personMarker(document),
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
      editor.setDecorations(this.noteDecorationType, []);
      return;
    }

    const content = editor.document.getText();
    const parseInlineTags = this.parseInlineTags(editor.document);
    const entityNamespaceAliases = this.entityNamespaceAliases(editor.document);
    const personMarker = this.personMarker(editor.document);
    const decorations = extractTagSpans(
      content,
      parseInlineTags,
      entityNamespaceAliases,
      personMarker,
    ).map((span) => ({
      range: new vscode.Range(
        span.lineNumber - 1,
        span.startColumn,
        span.lineNumber - 1,
        span.endColumn,
      ),
      hoverMessage: createTagRenameHoverMessage(span.label, span.key),
    }));
    editor.setDecorations(this.decorationType, decorations);

    const parsed = parseMarkdown('', content, undefined, {
      parseInlineTags,
      entityNamespaceAliases,
      personMarker,
    });
    const entries: EditorEntry[] = [];
    parsed.sections
      .filter(
        (section) =>
          (section.headingTags?.length ?? 0) > 0 ||
          (section.isInline && (section.associationTagGroups?.length ?? 0) > 0),
      )
      .forEach((section) =>
        entries.push({
          startLine: section.startLine,
          endLine: section.endLine,
          title: section.heading,
        }),
      );
    parsed.tasks
      .filter((task) => (task.associationTagGroups?.length ?? 0) > 0)
      .forEach((task) =>
        entries.push({
          startLine: task.lineNumber,
          endLine: task.lineNumber,
          title: task.title,
        }),
      );

    editor.setDecorations(
      this.noteDecorationType,
      this.shouldHighlightNoteSections(editor.document)
        ? entries.map((entry) => {
            const endLine =
              Math.min(entry.endLine, editor.document.lineCount) - 1;
            return {
              range: new vscode.Range(
                entry.startLine - 1,
                0,
                endLine,
                editor.document.lineAt(endLine).text.length,
              ),
              hoverMessage: createEntryRelatedNotesHoverMessage(
                entry.title,
                editor.document.uri.toString(),
                entry.startLine,
              ),
            };
          })
        : [],
    );
  }

  /**
   * Reads the setting from the document's workspace scope for multi-root use.
   */
  private parseInlineTags(document: vscode.TextDocument): boolean {
    return vscode.workspace
      .getConfiguration('deckard', document.uri)
      .get<boolean>('parseInlineTags', true);
  }

  private shouldHighlightNoteSections(document: vscode.TextDocument): boolean {
    return vscode.workspace
      .getConfiguration('deckard', document.uri)
      .get<boolean>('highlightNoteSections', true);
  }

  private entityNamespaceAliases(document: vscode.TextDocument) {
    return getEntityNamespaceAliases(
      vscode.workspace
        .getConfiguration('deckard', document.uri)
        .get<unknown>('entityNamespaceAliases', {}),
    );
  }

  private personMarker(document: vscode.TextDocument): string {
    return getPersonMarker(
      vscode.workspace
        .getConfiguration('deckard', document.uri)
        .get<unknown>('personMarker', '@'),
    );
  }
}

const markdownDocumentSelector: vscode.DocumentSelector = [
  { language: 'markdown' },
  { pattern: '**/*.md' },
];

interface EditorEntry {
  startLine: number;
  endLine: number;
  title: string;
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
  return createTagCommandUri('deckard.showTagOverview', tagKey);
}

function createTagRenameUri(tagKey: string): vscode.Uri {
  return createTagCommandUri('deckard.renameTag', tagKey);
}

function createEntryRelatedNotesUri(
  documentUri: string,
  lineNumber: number,
): vscode.Uri {
  return vscode.Uri.parse(
    `command:deckard.showEntryRelatedNotes?${encodeURIComponent(
      JSON.stringify([documentUri, lineNumber]),
    )}`,
  );
}

function createEntryRelatedNotesDebugUri(
  documentUri: string,
  lineNumber: number,
): vscode.Uri {
  return vscode.Uri.parse(
    `command:deckard.showEntryRelatedNotesDebug?${encodeURIComponent(
      JSON.stringify([documentUri, lineNumber]),
    )}`,
  );
}

function createTagCommandUri(command: string, tagKey: string): vscode.Uri {
  return vscode.Uri.parse(
    `command:${command}?${encodeURIComponent(JSON.stringify([tagKey]))}`,
  );
}

export function createTagRenameHoverMessage(
  label: string,
  tagKey: string,
): vscode.MarkdownString {
  const safeLabel = escapeMarkdown(label);
  const rename = new vscode.MarkdownString(
    `[Rename ${safeLabel}](${createTagRenameUri(tagKey)})`,
  );
  rename.isTrusted = {
    enabledCommands: ['deckard.renameTag'],
  };
  return rename;
}

export function createEntryRelatedNotesHoverMessage(
  title: string,
  documentUri: string,
  lineNumber: number,
): vscode.MarkdownString {
  const safeTitle = escapeMarkdown(title);
  const hover = new vscode.MarkdownString(
    `[Show related notes for ${safeTitle}](${createEntryRelatedNotesUri(documentUri, lineNumber)})  \n[Debug related notes for ${safeTitle}](${createEntryRelatedNotesDebugUri(documentUri, lineNumber)})`,
  );
  hover.isTrusted = {
    enabledCommands: [
      'deckard.showEntryRelatedNotes',
      'deckard.showEntryRelatedNotesDebug',
    ],
  };
  return hover;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]{}()#+.!|<>]/g, '\\$&');
}
