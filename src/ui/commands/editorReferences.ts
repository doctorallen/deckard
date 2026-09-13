import * as vscode from "vscode";

import {
  extractTagSpans,
  findFencedLines,
  getEntityNamespaceAliases,
  getPersonMarker,
} from "../../core/markdown/parser";
import { ParsedFile, Section, WorkspaceIndex } from "../../core/types";
import {
  BacklinkIndex,
  buildBacklinkIndex,
  findWikiLinkAt,
  WikiLinkOccurrence,
} from "../../core/workspace/backlinks";
import { isMarkdownFile } from "../../core/workspace/scanner";
import { createSidebarSnapshot } from "../state/dashboardState";
import {
  createLinkPreview,
  createReferenceSummary,
  createTagSummary,
  LinkPreview,
  TagSummary,
} from "../state/referenceState";
import { createEntryScope } from "../webview/sidebarNotes";
import { resolveSourceUri } from "./navigation";

interface ReferenceIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  parse(uri: vscode.Uri, content: string): ParsedFile;
}

/**
 * A count above a line. Its command, and whatever work finding it takes, is
 * built only when VS Code resolves the lens, so lenses scrolled out of view
 * cost nothing.
 */
class DeckardLens extends vscode.CodeLens {
  public constructor(
    range: vscode.Range,
    public readonly createCommand: () =>
      vscode.Command | Promise<vscode.Command>,
  ) {
    super(range);
  }
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
    vscode.CodeLensProvider<DeckardLens>,
    vscode.HoverProvider,
    vscode.Disposable
{
  private index: WorkspaceIndex | undefined;
  private backlinks: BacklinkIndex | undefined;
  /**
   * Related-entry counts by note, heading, and tags. Ranking reads the whole
   * workspace, so a count is kept until the index or a setting changes rather
   * than recomputed on every keystroke.
   */
  private readonly relatedCounts = new Map<string, number>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[];

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  public constructor(private readonly indexer: ReferenceIndexSource) {
    this.disposables = [
      this.changeEmitter,
      indexer.onDidUpdate((index) => {
        this.index = index;
        this.backlinks = undefined;
        this.relatedCounts.clear();
        this.changeEmitter.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("deckard")) {
          this.relatedCounts.clear();
          this.changeEmitter.fire();
        }
      }),
      vscode.languages.registerCodeLensProvider(markdownFiles, this),
      vscode.languages.registerHoverProvider(markdownFiles, this),
    ];
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  public provideCodeLenses(document: vscode.TextDocument): DeckardLens[] {
    if (
      !isMarkdownFile(document.uri) ||
      !readSetting(document, "referenceCounts")
    ) {
      return [];
    }
    const file = this.indexer.parse(document.uri, document.getText());
    const summary = createReferenceSummary(file, this.getBacklinks());
    const lenses: DeckardLens[] = [];

    if (summary.backlinks.length > 0) {
      const notes = new Set(summary.backlinks.map((link) => link.sourcePath))
        .size;
      lenses.push(
        createReferencesLens(
          document.uri,
          new vscode.Range(0, 0, 0, 0),
          `Linked from ${pluralize(notes, "note")}`,
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
            pluralize(heading.references.length, "reference"),
            () => locateLinks(heading.references),
          ),
        );
      }
      if (heading && heading.openTasks.length > 0) {
        lenses.push(
          createReferencesLens(
            document.uri,
            range,
            pluralize(heading.openTasks.length, "open task"),
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
      // Related Notes can focus only a tagged heading.
      if ((section.headingTags?.length ?? 0) > 0) {
        lenses.push(
          new DeckardLens(range, () =>
            this.createRelatedCommand(document, file, section),
          ),
        );
      }
    }
    return lenses;
  }

  public async resolveCodeLens(lens: DeckardLens): Promise<DeckardLens> {
    lens.command = await lens.createCommand();
    return lens;
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    if (
      !isMarkdownFile(document.uri) ||
      !readSetting(document, "hoverPreviews")
    ) {
      return undefined;
    }
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    if (findFencedLines(lines).has(position.line)) {
      return undefined;
    }

    const link = findWikiLinkAt(lines[position.line] ?? "", position.character);
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

    const configuration = vscode.workspace.getConfiguration(
      "deckard",
      document.uri,
    );
    const span = extractTagSpans(
      text,
      configuration.get<boolean>("parseInlineTags", true),
      getEntityNamespaceAliases(
        configuration.get<unknown>("entityNamespaceAliases", {}),
      ),
      getPersonMarker(configuration.get<unknown>("personMarker", "@")),
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
   * Counts what Related Notes lists for a heading, ranking it exactly as the
   * sidebar does, and opens the sidebar on that heading.
   */
  private createRelatedCommand(
    document: vscode.TextDocument,
    file: ParsedFile,
    section: Section,
  ): vscode.Command {
    const count = this.countRelatedEntries(document, file, section);
    if (count === 0) {
      return { title: "No related entries", command: "" };
    }
    return {
      title: count === 1 ? "1 related entry" : `${count} related entries`,
      tooltip: "Show them in Related Notes",
      command: "deckard.showEntryRelatedNotes",
      arguments: [document.uri.toString(), section.startLine],
    };
  }

  private countRelatedEntries(
    document: vscode.TextDocument,
    file: ParsedFile,
    section: Section,
  ): number {
    const scope = createEntryScope(file, section.startLine);
    if (!scope) {
      return 0;
    }
    // Keyed by what ranking reads rather than by line, so typing above a
    // heading does not rank it again.
    const key = JSON.stringify([
      file.filePath,
      section.heading,
      [...scope.tagWeights],
    ]);
    const cached = this.relatedCounts.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const configuration = vscode.workspace.getConfiguration(
      "deckard",
      document.uri,
    );
    const count = createSidebarSnapshot(
      this.getIndex(),
      file.filePath,
      scope.file,
      configuration.get<boolean>("enableKeywordLinks", true),
      "tags",
      {},
      "inline",
      undefined,
      scope.tagWeights,
      {
        associationMinimumSupport: configuration.get<number>(
          "relatedNotesAssociationMinimumSupport",
          1,
        ),
        recencyHalfLifeDays: configuration.get<number>(
          "relatedNotesRecencyHalfLifeDays",
          0,
        ),
      },
    ).notes.length;
    this.relatedCounts.set(key, count);
    return count;
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

const markdownFiles: vscode.DocumentSelector = { pattern: "**/*.md" };

function readSetting(
  document: vscode.TextDocument,
  name: "referenceCounts" | "hoverPreviews",
): boolean {
  return vscode.workspace
    .getConfiguration("deckard", document.uri)
    .get<boolean>(`editor.${name}`, true);
}

/** A count that lists links or tasks in VS Code's references peek. */
function createReferencesLens(
  documentUri: vscode.Uri,
  range: vscode.Range,
  title: string,
  locate: () => Promise<vscode.Location[]>,
): DeckardLens {
  return new DeckardLens(range, async () => ({
    title,
    tooltip: "Show them in the references view",
    command: "editor.action.showReferences",
    arguments: [documentUri, range.start, await locate()],
  }));
}

async function locateLinks(
  occurrences: readonly WikiLinkOccurrence[],
): Promise<vscode.Location[]> {
  const uris = new Map<string, vscode.Uri | undefined>();
  for (const occurrence of occurrences) {
    if (!uris.has(occurrence.sourcePath)) {
      uris.set(
        occurrence.sourcePath,
        await resolveSourceUri(occurrence.sourcePath),
      );
    }
  }
  return occurrences.flatMap((occurrence) => {
    const uri = uris.get(occurrence.sourcePath);
    return uri
      ? [
          new vscode.Location(
            uri,
            new vscode.Range(
              occurrence.line,
              occurrence.startColumn,
              occurrence.line,
              occurrence.endColumn,
            ),
          ),
        ]
      : [];
  });
}

/**
 * Previews a link's target. The excerpt is the note's own Markdown, shown
 * untrusted, so it can never run a command.
 */
async function renderLinkPreview(
  preview: LinkPreview,
): Promise<vscode.MarkdownString> {
  const markdown = new vscode.MarkdownString();
  if (preview.kind === "missing") {
    return markdown.appendMarkdown(
      `No note is named **${escapeMarkdown(preview.note)}** yet.`,
    );
  }
  if (preview.kind === "ambiguous") {
    return markdown.appendMarkdown(
      `**${escapeMarkdown(preview.note)}** matches ${preview.matches} notes, so Deckard cannot tell which one this link means.`,
    );
  }

  const fileName = preview.filePath.split("/").pop() ?? preview.filePath;
  markdown.appendMarkdown(
    `**${await linkToLine(preview.title, preview.filePath, preview.line)}** · ${escapeMarkdown(fileName)}\n\n`,
  );
  if (preview.missingHeading) {
    markdown.appendMarkdown(
      `*This note has no heading "${escapeMarkdown(preview.missingHeading)}", so this is its start.*\n\n`,
    );
  }
  markdown.appendMarkdown("---\n\n");
  markdown.appendMarkdown(preview.excerpt || "*Nothing written here yet.*");
  if (preview.truncated) {
    markdown.appendMarkdown("\n\n…");
  }
  markdown.appendMarkdown(
    `\n\n---\n\nLinked from ${pluralize(preview.backlinkCount, "other note")}`,
  );
  return markdown;
}

async function renderTagSummary(
  summary: TagSummary,
  tagKey: string,
): Promise<vscode.MarkdownString> {
  const counts = [
    pluralize(summary.noteCount, "note"),
    summary.taskCount > 0
      ? `${pluralize(summary.taskCount, "task")}, ${summary.openTaskCount} open`
      : "",
  ].filter(Boolean);
  const lines = [
    `**${escapeMarkdown(summary.label)}** · ${counts.join(" · ")}`,
    "",
  ];
  for (const entry of summary.entries) {
    const box = entry.task ? (entry.completed ? "☑ " : "☐ ") : "";
    lines.push(
      `- ${box}${await linkToLine(entry.title, entry.filePath, entry.line)} · ${escapeMarkdown(entry.fileName)}`,
    );
  }
  const shown = summary.entries.length;
  const total = summary.noteCount + summary.taskCount;
  if (total > shown) {
    lines.push("", `*…and ${total - shown} more*`);
  }
  const overview = `command:deckard.showTagOverview?${encodeURIComponent(JSON.stringify([tagKey]))}`;
  lines.push("", `[Open overview](${overview})`);

  const markdown = new vscode.MarkdownString(lines.join("\n"));
  markdown.isTrusted = { enabledCommands: ["deckard.showTagOverview"] };
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

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]{}()#+.!|<>]/g, "\\$&");
}
