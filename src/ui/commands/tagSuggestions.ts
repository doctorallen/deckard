import * as vscode from 'vscode';

import {
  findFencedLines,
  hasAtxHeadingClosingHashes,
} from '../../core/markdown/parser';
import { WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';

interface TagIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

/**
 * Describes the replacement range around the cursor, including any suffix the
 * user has already typed beyond the cursor.
 */
interface TagCompletionContext {
  marker: '@' | '#';
  query: string;
  startColumn: number;
  endColumn: number;
}

const tagTokenPattern = /(^|[^\w])([@#])([A-Za-z0-9][A-Za-z0-9_-]*)?$/;

/**
 * Suggests only indexed tags while respecting Markdown fences and token ranges.
 *
 * Waiting for the index prevents completion from presenting a partial tag list
 * during startup, while the explicit replacement range avoids duplicating a
 * suffix when completion is invoked in the middle of a token.
 */
export class TagCompletionProvider implements vscode.Disposable {
  private readonly registration: vscode.Disposable;

  public constructor(private readonly indexer: TagIndexSource) {
    this.registration = vscode.languages.registerCompletionItemProvider(
      { pattern: '**/*.md' },
      {
        provideCompletionItems: (document, position) =>
          this.provideCompletionItems(document, position),
      },
      '@',
      '#',
    );
  }

  /**
   * Unregisters the completion provider when the extension deactivates.
   */
  public dispose(): void {
    this.registration.dispose();
  }

  /**
   * Returns matching completions only for real Markdown content outside fences.
   */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    if (!isMarkdownFile(document.uri)) {
      return [];
    }

    const fencedLines = findFencedLines(document.getText().split(/\r?\n/));
    if (fencedLines.has(position.line)) {
      return [];
    }

    const line = document.lineAt(position.line).text;
    const context = getTagCompletionContext(line, position.character);
    if (!context) {
      return [];
    }

    if (
      context.marker === '#' &&
      context.endColumn === position.character &&
      hasAtxHeadingClosingHashes(line.slice(0, position.character))
    ) {
      return [];
    }

    await this.indexer.ready;
    const query = context.query.toLowerCase();
    return [...this.indexer.getSnapshot().tags.values()]
      .filter((tag) => tag.key.startsWith(query))
      .filter((tag) => context.marker !== '#' || !/^\d+$/.test(tag.key))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((tag) => {
        const item = new vscode.CompletionItem(
          `${context.marker}${tag.key}`,
          vscode.CompletionItemKind.Reference,
        );
        const entryLabel = tag.count === 1 ? 'entry' : 'entries';
        item.detail = `${tag.count} ${entryLabel}`;
        item.documentation = new vscode.MarkdownString(
          `Used in ${tag.count} ${entryLabel}`,
        );
        item.filterText = `${context.marker}${tag.key}`;
        item.insertText = `${context.marker}${tag.key}`;
        item.range = {
          inserting: new vscode.Range(
            position.line,
            context.startColumn,
            position.line,
            position.character,
          ),
          replacing: new vscode.Range(
            position.line,
            context.startColumn,
            position.line,
            context.endColumn,
          ),
        };
        return item;
      });
  }
}

/**
 * Finds a tag marker at the cursor and calculates a complete replacement range.
 *
 * A bare ATX heading marker is excluded because offering a tag there would
 * compete with Markdown heading syntax.
 */
export function getTagCompletionContext(
  line: string,
  character: number,
): TagCompletionContext | undefined {
  const linePrefix = line.slice(0, character);
  const match = linePrefix.match(tagTokenPattern);
  if (!match) {
    return undefined;
  }

  const marker = match[2] as '@' | '#';
  const query = match[3] ?? '';
  if (marker === '#' && query.length === 0 && /^\s*#{1,6}$/.test(linePrefix)) {
    return undefined;
  }

  const suffix = line.slice(character).match(/^[A-Za-z0-9_-]*/)?.[0] ?? '';

  return {
    marker,
    query,
    startColumn: (match.index ?? 0) + match[0].lastIndexOf(marker),
    endColumn: character + suffix.length,
  };
}
