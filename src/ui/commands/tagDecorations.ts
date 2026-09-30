import * as vscode from 'vscode';

import { extractTagSpans, parseMarkdown } from '../../core/markdown/parser';
import { KeyedDebouncer } from '../../core/debounce';
import { escapeMarkdown } from '../../core/text';
import { measure } from '../../core/timing';
import { ParsedFile } from '../../core/types';
import { readParseOptions } from './parseSettings';
import { createPinHoverUri } from './pinNote';
import { isMarkdownFile } from '../../core/workspace/scanner';

/**
 * How long typing must pause before a changed document is redrawn. VS Code
 * moves existing decorations along with each edit, so they stay in place
 * meanwhile.
 */
const decorationDelayMs = 150;

/**
 * Keeps tag appearance and click behavior synchronized in visible editors.
 *
 * Decoration types provide the visual affordance but no click callback, so a
 * document-link provider supplies navigation over the same parsed ranges.
 */
export class EditorTagDecorations implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /**
   * Whether an entry is pinned, so its hover offers pinning or unpinning.
   * The decorations know nothing of preferences themselves; the extension
   * hands them the one question they need answered.
   */
  private isPinned: (filePath: string, line: number) => boolean = () => false;
  /** Redraws waiting for typing to pause, by document URI. */
  private readonly pendingUpdates = new KeyedDebouncer(decorationDelayMs);
  private readonly decorationType =
    vscode.window.createTextEditorDecorationType({
      border: '1px solid',
      borderColor: new vscode.ThemeColor('textLink.foreground'),
      borderRadius: '2px',
      cursor: 'pointer',
      textDecoration: 'none',
    });
  /**
   * Every tagged entry's "Show related notes / Pin to Home" hover. It draws
   * nothing, so the hover is on every entry while the band is on one.
   */
  private readonly entryHoverType =
    vscode.window.createTextEditorDecorationType({});
  /**
   * The band behind the tagged section or task the cursor is in, in colors a
   * theme or `workbench.colorCustomizations` can set.
   */
  private readonly sectionBandType =
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('deckard.sectionHighlightBackground'),
      border: '0 0 0 1px solid',
      borderColor: new vscode.ThemeColor('deckard.sectionHighlightBorder'),
    });
  /** Each note's tagged entries, parsed once per version of the document. */
  private readonly entryCache = new Map<
    string,
    { version: number; entries: EditorEntry[] }
  >();
  /** The editor the band is drawn in, and the entry it is behind. */
  private band: { editor: vscode.TextEditor; key: string } | undefined;

  public constructor(
    /**
     * Whether a file is one of the notes. Tag boxes, links, the band, and the
     * entry hovers are drawn only there: a README in a code folder, or under
     * node_modules, is left alone.
     */
    private readonly isNotesFile: (uri: vscode.Uri) => boolean = () => true,
  ) {
    this.disposables.push(this.decorationType);
    this.disposables.push(this.entryHoverType);
    this.disposables.push(this.sectionBandType);
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.drawBand(event.textEditor);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.entryCache.delete(document.uri.toString());
      }),
    );
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
        // Focus in a webview leaves no active editor; the band stays where
        // it was, so a glance back finds the section still marked.
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
          event.affectsConfiguration('deckard.zenMode') ||
          event.affectsConfiguration('deckard.entityNamespaceAliases') ||
          event.affectsConfiguration('deckard.personMarker') ||
          event.affectsConfiguration('deckard.notesFolder') ||
          event.affectsConfiguration('deckard.exclude') ||
          event.affectsConfiguration('files.exclude') ||
          event.affectsConfiguration('search.exclude')
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
        if (
          event.contentChanges.length > 0 &&
          isMarkdownDocument(event.document)
        ) {
          this.scheduleUpdate(event.document);
        }
      }),
    );

    vscode.window.visibleTextEditors.forEach((editor) =>
      this.updateEditor(editor),
    );
  }

  /**
   * Releases the shared decoration type, pending redraws, and every
   * document/editor listener.
   */
  /** Tells the hovers how to ask whether an entry is pinned. */
  public setPinnedReader(
    isPinned: (filePath: string, line: number) => boolean,
  ): void {
    this.isPinned = isPinned;
    vscode.window.visibleTextEditors.forEach((editor) =>
      this.updateEditor(editor),
    );
  }

  public dispose(): void {
    this.pendingUpdates.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Creates command links from the same ranges used for visual decoration.
   */
  private provideDocumentLinks(
    document: vscode.TextDocument,
  ): vscode.DocumentLink[] {
    if (!this.isNote(document)) {
      return [];
    }

    return measure(
      'Tag links',
      () => {
        const text = document.getText();
        const options = readParseOptions(document.uri);
        return extractTagSpans(
          text,
          options.parseInlineTags,
          options.entityNamespaceAliases,
          options.personMarker,
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
      },
      (links) => `${links.length} links, ${document.lineCount} lines`,
    );
  }

  /**
   * Redraws a changed document's editors once typing pauses, rather than
   * reparsing the whole note on every keystroke.
   */
  private scheduleUpdate(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.pendingUpdates.schedule(key, () => {
      vscode.window.visibleTextEditors
        .filter((editor) => editor.document.uri.toString() === key)
        .forEach((editor) => this.updateEditor(editor));
    });
  }

  /**
   * Refreshes only the requested editor so edits do not disturb other views.
   */
  private isNote(document: vscode.TextDocument): boolean {
    return isMarkdownDocument(document) && this.isNotesFile(document.uri);
  }

  private updateEditor(editor: vscode.TextEditor): void {
    if (!this.isNote(editor.document)) {
      editor.setDecorations(this.decorationType, []);
      editor.setDecorations(this.entryHoverType, []);
      this.clearBand(editor);
      return;
    }

    measure(
      'Tag decorations',
      () => this.decorate(editor),
      () => `${editor.document.lineCount} lines`,
    );
  }

  private decorate(editor: vscode.TextEditor): void {
    const content = editor.document.getText();
    const { parseInlineTags, entityNamespaceAliases, personMarker } = readParseOptions(editor.document.uri);
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

    // Section highlighting needs the whole note parsed, so that parse is
    // skipped entirely when highlighting is off.
    if (!this.shouldHighlightNoteSections(editor.document)) {
      editor.setDecorations(this.entryHoverType, []);
      this.clearBand(editor);
      return;
    }

    const entries = this.readEntries(editor.document);
    editor.setDecorations(
      this.entryHoverType,
      entries.map((entry) => ({
        range: this.entryRange(editor, entry),
        hoverMessage: createEntryRelatedNotesHoverMessage(
          entry.title,
          editor.document.uri.toString(),
          entry.startLine,
          undefined,
          this.isPinned(editor.document.uri.fsPath, entry.startLine),
        ),
      })),
    );
    if (editor === vscode.window.activeTextEditor) {
      this.drawBand(editor, true);
    }
  }

  /** The note's tagged entries, parsed again only when the note changed. */
  private readEntries(document: vscode.TextDocument): EditorEntry[] {
    const key = document.uri.toString();
    const cached = this.entryCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.entries;
    }
    const entries = collectTaggedEntries(
      parseMarkdown('', document.getText(), undefined, readParseOptions(document.uri)),
    );
    this.entryCache.set(key, { version: document.version, entries });
    return entries;
  }

  private entryRange(editor: vscode.TextEditor, entry: EditorEntry): vscode.Range {
    const endLine = Math.min(entry.endLine, editor.document.lineCount) - 1;
    return new vscode.Range(
      entry.startLine - 1,
      0,
      endLine,
      editor.document.lineAt(endLine).text.length,
    );
  }

  /**
   * Draws the band behind the innermost tagged entry holding the cursor, in
   * the active editor only, and takes it out of the editor it was in before.
   * Nothing is redrawn while the cursor stays inside the same entry.
   */
  private drawBand(editor: vscode.TextEditor, force = false): void {
    if (this.band && this.band.editor !== editor) {
      this.clearBand(this.band.editor);
    }
    if (
      !this.isNote(editor.document) ||
      !this.shouldHighlightNoteSections(editor.document)
    ) {
      this.clearBand(editor);
      return;
    }
    const entry = findBandEntry(
      this.readEntries(editor.document),
      editor.selection.active.line + 1,
    );
    const key = entry ? `${entry.startLine}:${entry.endLine}` : '';
    if (!force && this.band?.editor === editor && this.band.key === key) {
      return;
    }
    editor.setDecorations(
      this.sectionBandType,
      entry ? [this.entryRange(editor, entry)] : [],
    );
    this.band = { editor, key };
  }

  private clearBand(editor: vscode.TextEditor): void {
    editor.setDecorations(this.sectionBandType, []);
    if (this.band?.editor === editor) {
      this.band = undefined;
    }
  }


  private shouldHighlightNoteSections(document: vscode.TextDocument): boolean {
    const configuration = vscode.workspace.getConfiguration('deckard', document.uri);
    // Zen quiets the editor too: the band behind the section being edited goes.
    return (
      configuration.get<boolean>('highlightNoteSections', true) &&
      !configuration.get<boolean>('zenMode', false)
    );
  }

}

const markdownDocumentSelector: vscode.DocumentSelector = [
  { language: 'markdown' },
  { pattern: '**/*.md' },
];

/** A tagged section or task in the editor: what the band and hover cover. */
export interface EditorEntry {
  startLine: number;
  endLine: number;
  title: string;
}

/**
 * The entries a note's hovers and band cover: sections with heading tags,
 * tagged inline blocks, and tagged tasks.
 */
export function collectTaggedEntries(
  parsed: Pick<ParsedFile, 'sections' | 'tasks'>,
): EditorEntry[] {
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
  return entries;
}

/**
 * The innermost entry holding a line (1-based): the one with the smallest
 * span, and of two alike, the one that starts later.
 */
export function findBandEntry(
  entries: readonly EditorEntry[],
  line: number,
): EditorEntry | undefined {
  let best: EditorEntry | undefined;
  for (const entry of entries) {
    if (line < entry.startLine || line > entry.endLine) {
      continue;
    }
    const span = entry.endLine - entry.startLine;
    const bestSpan = best ? best.endLine - best.startLine : Infinity;
    if (!best || span < bestSpan || (span === bestSpan && entry.startLine > best.startLine)) {
      best = entry;
    }
  }
  return best;
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
  /**
   * Whether to offer the ranking breakdown as well. It explains Deckard to
   * itself, so it is offered only where it was asked for: every tagged entry
   * used to carry the link.
   */
  includeDebug = vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('developerMode', false),
  /** Whether this entry is already pinned, which names the pin link. */
  pinned = false,
): vscode.MarkdownString {
  const safeTitle = escapeMarkdown(title);
  const debugLink = includeDebug
    ? `  \n[Debug related notes for ${safeTitle}](${createEntryRelatedNotesDebugUri(documentUri, lineNumber)})`
    : '';
  // Pinning belongs beside the other thing this entry can do, since this
  // hover is where an entry is already in front of the reader.
  const pinLink = `  \n[${
    pinned ? 'Unpin' : 'Pin'
  } ${safeTitle} ${pinned ? 'from' : 'to'} Home](${createPinHoverUri(
    documentUri,
    lineNumber,
    pinned,
  )})`;
  const hover = new vscode.MarkdownString(
    `[Show related notes for ${safeTitle}](${createEntryRelatedNotesUri(documentUri, lineNumber)})${pinLink}${debugLink}`,
  );
  hover.isTrusted = {
    enabledCommands: [
      'deckard.showEntryRelatedNotes',
      'deckard.pinNote',
      'deckard.unpinNote',
      ...(includeDebug ? ['deckard.showEntryRelatedNotesDebug'] : []),
    ],
  };
  return hover;
}
