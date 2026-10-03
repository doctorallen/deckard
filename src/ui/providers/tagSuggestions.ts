import * as vscode from 'vscode';

import { hasAtxHeadingClosingHashes } from '../../domain/markdown/parser';
import {
  getTagCompletionContext,
  matchesTagCompletion,
  TagCompletionContext,
} from '../../domain/markdown/completionContext';
import type { TagInfo } from '../../domain/model/tags';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { findQueryBlocks, isQueryBlockLine } from '../state/queryBlockState';
import { whenPublished } from '../../core/workspace/publishing';
import { isParkedFile, isParkedOnlyTag } from '../../domain/index/parked';
import { readPersonMarker } from '../commands/parseSettings';
import { WorkspaceIndex } from '../../domain/model';
import { findFencedLines } from '../../domain/markdown/lineShapes';

/** What tag completion reads from the indexer. */
interface TagIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  /** Whether a file is one of the notes, not a README in a code folder. */
  isNotesFile?(uri: vscode.Uri): boolean;
  /** The note's path in the index, which says whether it is parked. */
  getFilePath?(uri: vscode.Uri): string;
}

/** Whether tag completion is on for a document, from `deckard.enableTagAutocomplete`. */
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
    const index = this.indexer.getSnapshot();
    // A tag only parked notes carry is left out, except while writing in a
    // parked note, where those are the tags in use.
    const filePath = this.indexer.getFilePath?.(document.uri);
    const offerParked = filePath !== undefined && isParkedFile(index, filePath);
    return selectTagCompletions(index, context, { personMarker, offerParked }).map((row) =>
      toCompletionItem(row, context, position),
    );
  }
}

/** One tag offered: what is written when it is picked, and how many entries carry it. */
interface TagCompletion {
  label: string;
  count: number;
}

/**
 * The indexed tags that complete what is typed, sorted by label. A tag only
 * parked notes carry is left out unless `offerParked`, and after `#` a tag
 * that is only a number is left out, since `#12` is more often an issue
 * number than a tag.
 */
function selectTagCompletions(
  index: WorkspaceIndex,
  context: TagCompletionContext,
  { personMarker, offerParked }: { personMarker: string; offerParked: boolean },
): TagCompletion[] {
  const query = context.query.toLowerCase();
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
    .map((tag) => ({
      label: completionLabel(tag, context.marker, personMarker),
      count: tag.count,
    }));
}

/**
 * A tag as it is written after the marker typed: a person with the person
 * marker in use, an `@` tag as `@name`, and any other tag as its label.
 */
function completionLabel(tag: TagInfo, marker: string, personMarker: string): string {
  if (marker === personMarker && tag.key.startsWith('@')) {
    return `${personMarker}${tag.key.slice(1)}`;
  }
  if (marker === '@' && tag.key.startsWith('#tag-at/')) {
    return `@${tag.key.slice('#tag-at/'.length)}`;
  }
  return tag.label;
}

/**
 * A completion that inserts up to the cursor, or replaces the whole token
 * when completion is invoked in its middle, so no suffix is left doubled.
 */
function toCompletionItem(
  { label, count }: TagCompletion,
  context: TagCompletionContext,
  position: vscode.Position,
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    label,
    vscode.CompletionItemKind.Reference,
  );
  const entryLabel = count === 1 ? 'entry' : 'entries';
  item.detail = `${count} ${entryLabel}`;
  item.documentation = new vscode.MarkdownString(
    `Used in ${count} ${entryLabel}`,
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
}
