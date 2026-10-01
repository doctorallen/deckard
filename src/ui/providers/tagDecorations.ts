import * as vscode from 'vscode';

import { extractTagSpans, parseMarkdown } from '../../domain/markdown/parser';
import {
  collectTaggedEntries,
  EditorEntry,
  findBandEntry,
} from '../../domain/markdown/taggedEntries';
import { KeyedDebouncer } from '../../shared/debounce';
import { escapeMarkdown } from '../../shared/text';
import { measure } from '../../shared/timing';
import { readParseOptions } from '../commands/parseSettings';
import { createPinHoverUri } from '../commands/pinNote';
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
  /** The decoration types, then every listener `register` adds. */
  private readonly disposables: vscode.Disposable[] = [
    this.decorationType,
    this.entryHoverType,
    this.sectionBandType,
  ];
  /** Each note's tagged entries, parsed once per version of the document. */
  private readonly entryCache = new Map<
    string,
    { version: number; entries: EditorEntry[] }
  >();
  /** The editor the band is drawn in, and the entry it is behind. */
  private band: { editor: vscode.TextEditor; key: string } | undefined;

  /**
   * Takes the notes test; nothing is drawn or registered until `register`.
   */
  public constructor(
    /**
     * Whether a file is one of the notes. Tag boxes, links, the band, and the
     * entry hovers are drawn only there: a README in a code folder, or under
     * node_modules, is left alone.
     */
    private readonly isNotesFile: (uri: vscode.Uri) => boolean = () => true,
  ) {}

  /**
   * Registers the tag links for Markdown documents, listens to the editors
   * and documents it draws in, and draws every visible editor. Returns the
   * decorations, so the composition root can build and register them in one
   * expression.
   */
  public register(): this {
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
    return this;
  }

  /** Tells the hovers how to ask whether an entry is pinned. */
  public setPinnedReader(
    isPinned: (filePath: string, line: number) => boolean,
  ): void {
    this.isPinned = isPinned;
    vscode.window.visibleTextEditors.forEach((editor) =>
      this.updateEditor(editor),
    );
  }

  /**
   * Releases the shared decoration type, pending redraws, and every
   * document/editor listener.
   */
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

  /** Whether a document is a note, the only place anything is drawn. */
  private isNote(document: vscode.TextDocument): boolean {
    return isMarkdownDocument(document) && this.isNotesFile(document.uri);
  }

  /**
   * Refreshes only the requested editor so edits do not disturb other views.
   */
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
        hoverMessage: createEntryRelatedNotesHoverMessage({
          title: entry.title,
          documentUri: editor.document.uri.toString(),
          lineNumber: entry.startLine,
          pinned: this.isPinned(editor.document.uri.fsPath, entry.startLine),
        }),
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

/** A tag's hover: a trusted link that renames the tag, and nothing else. */
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

/** The tagged entry a hover is about, and what its links offer. */
export interface EntryHoverOptions {
  title: string;
  documentUri: string;
  lineNumber: number;
  /**
   * Whether to offer the ranking breakdown as well. It explains Deckard to
   * itself, so it is offered only where it was asked for: every tagged entry
   * used to carry the link. `deckard.developerMode` by default.
   */
  includeDebug?: boolean;
  /** Whether this entry is already pinned, which names the pin link. */
  pinned?: boolean;
}

/**
 * A tagged entry's hover: trusted links that show its related notes, pin or
 * unpin it, and in developer mode explain its ranking.
 */
export function createEntryRelatedNotesHoverMessage({
  title,
  documentUri,
  lineNumber,
  includeDebug = vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('developerMode', false),
  pinned = false,
}: EntryHoverOptions): vscode.MarkdownString {
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
