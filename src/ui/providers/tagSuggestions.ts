import * as vscode from 'vscode';

import { findFencedLines, hasAtxHeadingClosingHashes } from '../../domain/markdown/parser';
import {
  getTagCompletionContext,
  matchesTagCompletion,
} from '../../domain/markdown/completionContext';
import { WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { findQueryBlocks, isQueryBlockLine } from '../state/queryBlockState';
import { whenPublished } from '../../core/workspace/publishing';
import { isParkedFile, isParkedOnlyTag } from '../../domain/index/parked';
import { readPersonMarker } from '../commands/parseSettings';

interface TagIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  /** Whether a file is one of the notes, not a README in a code folder. */
  isNotesFile?(uri: vscode.Uri): boolean;
  /** The note's path in the index, which says whether it is parked. */
  getFilePath?(uri: vscode.Uri): string;
}

type TagAutocompleteEnabled = (document: vscode.TextDocument) => boolean;

/** Where tags are completed: every Markdown file, which the provider narrows to notes. */
const TAG_SELECTOR: vscode.DocumentSelector = { pattern: '**/*.md' };

/**
 * The characters that open tag completions: the markers, then punctuation,
 * which the provider checks against the cursor's line before it reads the
 * whole document.
 */
const TAG_TRIGGER_CHARACTERS = [
  '@', '#', '!', '$', '%', '&', '*', '+', ',', '.', ':', ';', '=', '?', '^', '|', '~',
];

/**
 * Suggests only indexed tags while respecting Markdown fences and token ranges.
 *
 * Waiting for the index prevents completion from presenting a partial tag list
 * during startup, while the explicit replacement range avoids duplicating a
 * suffix when completion is invoked in the middle of a token.
 */
export class TagCompletionProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];

  /**
   * Takes the index to complete from and the setting that turns completion
   * off; nothing is registered until `register`.
   */
  public constructor(
    private readonly indexer: TagIndexSource,
    private readonly isAutocompleteEnabled: TagAutocompleteEnabled = (
      document,
    ) =>
      vscode.workspace
        .getConfiguration('deckard', document.uri)
        .get<boolean>('enableTagAutocomplete', true),
  ) {}

  /**
   * Registers the provider for Markdown files with the characters that start
   * or precede a tag. Returns the provider, so the composition root can build
   * and register it in one expression.
   */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCompletionItemProvider(
        TAG_SELECTOR,
        {
          provideCompletionItems: (document, position) =>
            this.provideCompletionItems(document, position),
        },
        ...TAG_TRIGGER_CHARACTERS,
      ),
    );
    return this;
  }

  /**
   * Unregisters the completion provider when the extension deactivates.
   */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * Returns matching completions only for real Markdown content outside fences.
   */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    if (
      !this.isAutocompleteEnabled(document) ||
      !isMarkdownFile(document.uri) ||
      !(this.indexer.isNotesFile?.(document.uri) ?? true)
    ) {
      return [];
    }

    // Punctuation such as `.` and `,` also triggers completion, so the cursor's
    // line is checked for a tag before anything reads the whole document.
    const line = document.lineAt(position.line).text;
    const personMarker = readPersonMarker(document.uri);
    const context = getTagCompletionContext(
      line,
      position.character,
      personMarker,
    );
    if (!context) {
      return [];
    }

    const text = document.getText();
    const fencedLines = findFencedLines(text.split(/\r?\n/));
    // Fenced code is ignored, except a query block, where tags are exactly
    // what the author is writing.
    if (
      fencedLines.has(position.line) &&
      !isQueryBlockLine(findQueryBlocks(text), position.line)
    ) {
      return [];
    }

    if (
      context.marker === '#' &&
      context.endColumn === position.character &&
      hasAtxHeadingClosingHashes(line.slice(0, position.character))
    ) {
      return [];
    }

    await whenPublished(this.indexer);
    const query = context.query.toLowerCase();
    const index = this.indexer.getSnapshot();
    // A tag only parked notes carry is left out, except while writing in a
    // parked note, where those are the tags in use.
    const filePath = this.indexer.getFilePath?.(document.uri);
    const offerParked = filePath !== undefined && isParkedFile(index, filePath);
    return [...index.tags.values()]
      .filter((tag) =>
        matchesTagCompletion(tag, context.marker, query, personMarker),
      )
      .filter((tag) => offerParked || !isParkedOnlyTag(index, tag.key))
      .filter(
        (tag) =>
          context.marker !== '#' || !/^#?\d+$/.test(tag.key),
      )
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((tag) => {
        const label =
          context.marker === personMarker && tag.key.startsWith('@')
            ? `${personMarker}${tag.key.slice(1)}`
            : context.marker === '@' && tag.key.startsWith('#tag-at/')
              ? `@${tag.key.slice('#tag-at/'.length)}`
            : tag.label;
        const item = new vscode.CompletionItem(
          label,
          vscode.CompletionItemKind.Reference,
        );
        const entryLabel = tag.count === 1 ? 'entry' : 'entries';
        item.detail = `${tag.count} ${entryLabel}`;
        item.documentation = new vscode.MarkdownString(
          `Used in ${tag.count} ${entryLabel}`,
        );
        item.filterText = label;
        item.insertText = label;
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
