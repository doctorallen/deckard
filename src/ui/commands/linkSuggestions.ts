import * as vscode from 'vscode';

import { WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { resolveSourceUri } from './navigation';

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

/**
 * Completes and resolves workspace note titles inside Wiki links without
 * changing source files until the user explicitly accepts a completion item.
 */
export class WikiLinkCompletionProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[];

  public constructor(private readonly indexer: IndexSource) {
    this.registrations = [
      vscode.languages.registerCompletionItemProvider(
        { pattern: '**/*.md' },
        {
          provideCompletionItems: (document, position) =>
            this.provideCompletionItems(document, position),
        },
        '[',
      ),
      vscode.languages.registerDocumentLinkProvider(
        { pattern: '**/*.md' },
        {
          provideDocumentLinks: (document) =>
            this.provideDocumentLinks(document),
        },
      ),
    ];
  }

  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    if (!isMarkdownFile(document.uri)) {
      return [];
    }

    const line = document.lineAt(position.line).text;
    const context = getWikiLinkCompletionContext(line, position.character);
    if (!context) {
      return [];
    }

    await this.indexer.ready;
    const query = context.query.toLowerCase();
    return [...this.indexer.getSnapshot().files.keys()]
      .map((filePath) => ({
        filePath,
        title: getNoteTitle(filePath),
      }))
      .filter((note) => note.title.toLowerCase().includes(query))
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.filePath.localeCompare(right.filePath),
      )
      .map((note) => {
        const item = new vscode.CompletionItem(
          note.title,
          vscode.CompletionItemKind.File,
        );
        item.detail = note.filePath;
        item.insertText = `${note.title}]]`;
        item.range = new vscode.Range(
          position.line,
          context.startColumn,
          position.line,
          position.character,
        );
        return item;
      });
  }

  /**
   * Turns complete, unambiguous Wiki links into native editor links. Titles
   * that match multiple notes remain plain text rather than opening a
   * potentially incorrect target.
   */
  public async provideDocumentLinks(
    document: vscode.TextDocument,
  ): Promise<vscode.DocumentLink[]> {
    if (!isMarkdownFile(document.uri)) {
      return [];
    }

    await this.indexer.ready;
    const links = findWikiLinkTargets(document.getText(), this.indexer.getSnapshot());
    const resolved = await Promise.all(
      links.map(async (link) => ({
        link,
        target: await resolveSourceUri(link.filePath),
      })),
    );

    return resolved.flatMap(({ link, target }) => {
      if (!target) {
        return [];
      }

      const range = new vscode.Range(
        document.positionAt(link.startOffset),
        document.positionAt(link.endOffset),
      );
      const documentLink = new vscode.DocumentLink(range, target);
      documentLink.tooltip = `Open ${link.title}`;
      return [documentLink];
    });
  }
}

export function getWikiLinkCompletionContext(
  line: string,
  character: number,
): { query: string; startColumn: number } | undefined {
  const prefix = line.slice(0, character);
  const match = prefix.match(/\[\[([^\]|]*)$/);
  if (!match) {
    return undefined;
  }

  return {
    query: match[1],
    startColumn: character - match[1].length,
  };
}

function getNoteTitle(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName.replace(/\.md$/i, '');
}

interface WikiLinkTarget {
  readonly title: string;
  readonly filePath: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

/**
 * Resolves only exact, case-insensitive title matches so duplicate note names
 * cannot make an editor link point at the wrong file.
 */
export function findWikiLinkTargets(
  content: string,
  index: WorkspaceIndex,
): WikiLinkTarget[] {
  const notesByTitle = new Map<string, string[]>();

  index.files.forEach((_file, filePath) => {
    const title = getNoteTitle(filePath).toLocaleLowerCase();
    const files = notesByTitle.get(title) ?? [];
    files.push(filePath);
    notesByTitle.set(title, files);
  });

  const links: WikiLinkTarget[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  for (const match of content.matchAll(pattern)) {
    const title = match[1].trim();
    const matches = notesByTitle.get(title.toLocaleLowerCase()) ?? [];
    if (matches.length !== 1 || match.index === undefined) {
      continue;
    }

    links.push({
      title,
      filePath: matches[0],
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  return links;
}
