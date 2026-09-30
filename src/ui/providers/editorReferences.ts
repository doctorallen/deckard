import * as vscode from 'vscode';

import { extractTagSpans, findFencedLines } from '../../domain/markdown/parser';
import { escapeMarkdown, pluralize } from '../../shared/text';
import { measure } from '../../shared/timing';
import { ParsedFile, Section, WorkspaceIndex } from '../../core/types';
import {
  BacklinkIndex,
  buildBacklinkIndex,
  findWikiLinkAt,
  WikiLinkOccurrence,
} from '../../domain/index/backlinks';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  countSharedTagEntries,
  createLinkPreview,
  createReferenceSummary,
  createTagSummary,
  LinkPreview,
  TagSummary,
} from '../state/referenceState';
import { createEntryScope } from '../state/entryScope';
import { resolveSourceUri } from '../commands/navigation';
import { LazyCodeLens, locate, resolveLazyCodeLens } from './codeLenses';
import { readParseOptions } from '../commands/parseSettings';

interface ReferenceIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  parse(uri: vscode.Uri, content: string): ParsedFile;
  /** Whether a file is one of the notes, not a README in a code folder. */
  isNotesFile?(uri: vscode.Uri): boolean;
}

/**
 * Brings a note's connections into the editor through VS Code's own surfaces:
 * counts above the lines that open the references peek or Related Notes, and
 * hovers that preview a `[[link]]` or summarize a tag.
 *
 * Links come from the saved workspace, gathered once per index update; the
 * headings and tasks being counted come from the editor, so they follow
 * unsaved edits.
 */
export class EditorReferences
  implements
    vscode.CodeLensProvider<LazyCodeLens>,
    vscode.HoverProvider,
    vscode.Disposable
{
  private index: WorkspaceIndex | undefined;
  private backlinks: BacklinkIndex | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  /**
   * Takes the index the counts and previews read; nothing is registered
   * until `register`.
   */
  public constructor(private readonly indexer: ReferenceIndexSource) {}

  /**
   * Registers the counts and the hovers for Markdown files, and redraws the
   * counts when the index or a Deckard setting changes. Returns the
   * provider, so the composition root can build and register it in one
   * expression.
   */
  public register(): this {
    this.disposables.push(
      this.indexer.onDidUpdate((index) => {
        this.index = index;
        this.backlinks = undefined;
        this.changeEmitter.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard')) {
          this.changeEmitter.fire();
        }
      }),
      vscode.languages.registerCodeLensProvider(markdownFiles, this),
      vscode.languages.registerHoverProvider(markdownFiles, this),
    );
    return this;
  }

  /** Unregisters the counts and hovers and stops listening for changes. */
  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /** Lenses and hovers belong to notes, not to every Markdown file. */
  private isNote(document: vscode.TextDocument): boolean {
    return (
      isMarkdownFile(document.uri) &&
      (this.indexer.isNotesFile?.(document.uri) ?? true)
    );
  }

  /**
   * The counts above a note's lines: the notes linking to it, and for each
   * heading its references, open tasks, and entries sharing a tag. None in
   * zen, when `deckard.editor.referenceCounts` is off, or outside the notes.
   */
  public provideCodeLenses(document: vscode.TextDocument): LazyCodeLens[] {
    if (
      !this.isNote(document) ||
      !readSetting(document, 'referenceCounts')
    ) {
      return [];
    }
    return measure(
      'Reference lenses',
      () => this.createCodeLenses(document),
      (lenses) => `${lenses.length} lenses, ${document.lineCount} lines`,
    );
  }

  private createCodeLenses(document: vscode.TextDocument): LazyCodeLens[] {
    const file = this.indexer.parse(document.uri, document.getText());
    const summary = createReferenceSummary(file, this.getBacklinks());
    const lenses: LazyCodeLens[] = [];

    if (summary.backlinks.length > 0) {
      const notes = new Set(summary.backlinks.map((link) => link.sourcePath))
        .size;
      lenses.push(
        createReferencesLens(
          document.uri,
          new vscode.Range(0, 0, 0, 0),
          `Linked from ${pluralize(notes, 'note')}`,
          () => locateLinks(summary.backlinks),
        ),
      );
    }

    const headings = new Map(
      summary.headings.map((heading) => [heading.line, heading]),
    );
    for (const section of file.sections.filter((entry) => !entry.isInline)) {
      const line = section.startLine - 1;
      const range = new vscode.Range(line, 0, line, 0);
      const heading = headings.get(line);
      if (heading && heading.references.length > 0) {
        lenses.push(
          createReferencesLens(
            document.uri,
            range,
            pluralize(heading.references.length, 'reference'),
            () => locateLinks(heading.references),
          ),
        );
      }
      if (heading && heading.openTasks.length > 0) {
        lenses.push(
          createReferencesLens(
            document.uri,
            range,
            pluralize(heading.openTasks.length, 'open task'),
            async () =>
              heading.openTasks.map(
                (task) =>
                  new vscode.Location(
                    document.uri,
                    new vscode.Position(
                      task.lineNumber - 1,
                      Math.max(task.checkboxColumn - 1, 0),
                    ),
                  ),
              ),
          ),
        );
      }
      // Related Notes can focus only a tagged heading. A heading nothing
      // shares a tag with gets no lens at all: it used to carry a line
      // reading "No entries share a tag" that could not even be clicked.
      if ((section.headingTags?.length ?? 0) > 0) {
        const sharedTagCount = this.countSharedTagEntries(file, section);
        if (sharedTagCount > 0) {
          lenses.push(
            new LazyCodeLens(range, () =>
              this.createRelatedCommand(document, section, sharedTagCount),
            ),
          );
        }
      }
    }
    return lenses;
  }

  /** Builds a count's command once VS Code shows it. */
  public resolveCodeLens(lens: LazyCodeLens): Promise<LazyCodeLens> {
    return resolveLazyCodeLens(lens);
  }

  /**
   * A preview of the `[[link]]` under the cursor, or else a summary of the
   * tag there; nothing in fenced code, outside the notes, or when
   * `deckard.editor.hoverPreviews` is off.
   */
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    if (
      !this.isNote(document) ||
      !readSetting(document, 'hoverPreviews')
    ) {
      return undefined;
    }
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    if (findFencedLines(lines).has(position.line)) {
      return undefined;
    }

    const link = findWikiLinkAt(lines[position.line] ?? '', position.character);
    if (link) {
      const preview = createLinkPreview(
        this.getIndex(),
        this.getBacklinks(),
        link.target,
        this.indexer.getFilePath(document.uri),
      );
      return new vscode.Hover(
        await renderLinkPreview(preview),
        new vscode.Range(
          position.line,
          link.startColumn,
          position.line,
          link.endColumn,
        ),
      );
    }

    const options = readParseOptions(document.uri);
    const span = extractTagSpans(
      text,
      options.parseInlineTags,
      options.entityNamespaceAliases,
      options.personMarker,
    ).find(
      (candidate) =>
        candidate.lineNumber - 1 === position.line &&
        position.character >= candidate.startColumn &&
        position.character < candidate.endColumn,
    );
    const summary = span
      ? createTagSummary(this.getIndex(), span.key)
      : undefined;
    if (!span || !summary) {
      return undefined;
    }
    return new vscode.Hover(
      await renderTagSummary(summary, span.key),
      new vscode.Range(
        position.line,
        span.startColumn,
        position.line,
        span.endColumn,
      ),
    );
  }

  /**
   * Counts the entries in other notes that share a tag written on the
   * heading, and opens Related Notes on the heading, which lists them along
   * with its weaker matches.
   */
  private createRelatedCommand(
    document: vscode.TextDocument,
    section: Section,
    count: number,
  ): vscode.Command {
    return {
      title:
        count === 1 ? '1 entry shares a tag' : `${count} entries share a tag`,
      tooltip:
        'Show in Related Notes: entries sharing a tag, then weaker matches',
      command: 'deckard.showEntryRelatedNotes',
      arguments: [document.uri.toString(), section.startLine],
    };
  }

  /**
   * Only tags written on the heading count. A parent heading's tags, or front
   * matter every heading inherits, would give every heading in a note the same
   * large count. The count reads the index directly rather than ranking the
   * workspace, so it is cheap enough to redo after every save.
   */
  private countSharedTagEntries(file: ParsedFile, section: Section): number {
    const scope = createEntryScope(file, section.startLine);
    if (!scope) {
      return 0;
    }
    const ownTags = [...scope.tagSources]
      .filter(([, source]) => source.context === 'selected')
      .map(([tagKey]) => tagKey);
    return countSharedTagEntries(this.getIndex(), file.filePath, ownTags);
  }

  private getIndex(): WorkspaceIndex {
    this.index ??= this.indexer.getSnapshot();
    return this.index;
  }

  private getBacklinks(): BacklinkIndex {
    this.backlinks ??= buildBacklinkIndex(this.getIndex());
    return this.backlinks;
  }
}

const markdownFiles: vscode.DocumentSelector = { pattern: '**/*.md' };

function readSetting(
  document: vscode.TextDocument,
  name: 'referenceCounts' | 'hoverPreviews',
): boolean {
  const configuration = vscode.workspace.getConfiguration('deckard', document.uri);
  // Zen quiets the editor as it quiets the pages: the counts above each
  // heading go, and the previews a reader asks for by hovering stay.
  if (name === 'referenceCounts' && configuration.get<boolean>('zenMode', false)) {
    return false;
  }
  return configuration.get<boolean>(`editor.${name}`, true);
}

/** A count that lists links or tasks in VS Code's references peek. */
function createReferencesLens(
  documentUri: vscode.Uri,
  range: vscode.Range,
  title: string,
  locate: () => Promise<vscode.Location[]>,
): LazyCodeLens {
  return new LazyCodeLens(range, async () => ({
    title,
    tooltip: 'Show them in the references view',
    command: 'editor.action.showReferences',
    arguments: [documentUri, range.start, await locate()],
  }));
}

/** Where each link was written, for the references peek. */
function locateLinks(
  occurrences: readonly WikiLinkOccurrence[],
): Promise<vscode.Location[]> {
  return locate(
    occurrences,
    (occurrence) => occurrence.sourcePath,
    (occurrence) =>
      new vscode.Range(
        occurrence.line,
        occurrence.startColumn,
        occurrence.line,
        occurrence.endColumn,
      ),
  );
}

/**
 * Previews a link's target. The excerpt is the note's own Markdown, shown
 * untrusted, so it can never run a command.
 */
async function renderLinkPreview(
  preview: LinkPreview,
): Promise<vscode.MarkdownString> {
  const markdown = new vscode.MarkdownString();
  if (preview.kind === 'missing') {
    return markdown.appendMarkdown(
      `No note is named **${escapeMarkdown(preview.note)}** yet.`,
    );
  }
  if (preview.kind === 'ambiguous') {
    return markdown.appendMarkdown(
      `**${escapeMarkdown(preview.note)}** matches ${preview.matches} notes, so Deckard cannot tell which one this link means.`,
    );
  }

  const fileName = preview.filePath.split('/').pop() ?? preview.filePath;
  markdown.appendMarkdown(
    `**${await linkToLine(preview.title, preview.filePath, preview.line)}** · ${escapeMarkdown(fileName)}\n\n`,
  );
  if (preview.missingHeading) {
    markdown.appendMarkdown(
      `*This note has no heading "${escapeMarkdown(preview.missingHeading)}", so this is its start.*\n\n`,
    );
  }
  if (preview.missingBlock) {
    markdown.appendMarkdown(
      `*This note has no line marked \`^${escapeMarkdown(preview.missingBlock)}\`, so this is its start.*\n\n`,
    );
  }
  markdown.appendMarkdown('---\n\n');
  markdown.appendMarkdown(preview.excerpt || '*Nothing written here yet.*');
  if (preview.truncated) {
    markdown.appendMarkdown('\n\n…');
  }
  markdown.appendMarkdown(
    `\n\n---\n\nLinked from ${pluralize(preview.backlinkCount, 'other note')}`,
  );
  return markdown;
}

async function renderTagSummary(
  summary: TagSummary,
  tagKey: string,
): Promise<vscode.MarkdownString> {
  const counts = [
    pluralize(summary.noteCount, 'note'),
    summary.taskCount > 0
      ? `${pluralize(summary.taskCount, 'task')}, ${summary.openTaskCount} open`
      : '',
  ].filter(Boolean);
  const lines = [
    `**${escapeMarkdown(summary.label)}** · ${counts.join(' · ')}`,
    '',
  ];
  if (summary.hubFilePath) {
    const hubFileName =
      summary.hubFilePath.split('/').pop() ?? summary.hubFilePath;
    lines.push(
      `Hub: ${await linkToLine(hubFileName, summary.hubFilePath, 1)}`,
      '',
    );
  }
  for (const entry of summary.entries) {
    const box = entry.task ? (entry.completed ? '☑ ' : '☐ ') : '';
    lines.push(
      `- ${box}${await linkToLine(entry.title, entry.filePath, entry.line)} · ${escapeMarkdown(entry.fileName)}`,
    );
  }
  const shown = summary.entries.length;
  const total = summary.noteCount + summary.taskCount;
  if (total > shown) {
    lines.push('', `*…and ${total - shown} more*`);
  }
  const overview = `command:deckard.showTagOverview?${encodeURIComponent(JSON.stringify([tagKey]))}`;
  lines.push('', `[Open overview](${overview})`);

  const markdown = new vscode.MarkdownString(lines.join('\n'));
  markdown.isTrusted = { enabledCommands: ['deckard.showTagOverview'] };
  return markdown;
}

/** A link that opens a file at a line, or plain text when the file is gone. */
async function linkToLine(
  title: string,
  filePath: string,
  line: number,
): Promise<string> {
  const uri = await resolveSourceUri(filePath);
  return uri
    ? `[${escapeMarkdown(title)}](${uri.with({ fragment: `L${line}` }).toString()})`
    : escapeMarkdown(title);
}
