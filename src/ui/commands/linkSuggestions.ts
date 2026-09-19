import * as vscode from 'vscode';

import { BLOCK_ID_PATTERN } from '../../core/markdown/parser';
import { measureAsync } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  findLinkedBlock,
  findLinkedSection,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../core/workspace/backlinks';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { resolveSourceUri } from './navigation';

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  /** The document's index key, which `[[#Heading]]` links point into. */
  getFilePath?(uri: vscode.Uri): string;
}

/**
 * Completes and resolves workspace note titles inside Wiki links without
 * changing source files until the user explicitly accepts a completion item.
 */
export class WikiLinkCompletionProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[];
  /**
   * Link targets resolved against one index. Resolving checks the file
   * system, and VS Code asks for links after every edit, so each note is
   * resolved once until the index changes.
   */
  private readonly resolvedTargets = new WeakMap<
    WorkspaceIndex,
    Map<string, Promise<vscode.Uri | undefined>>
  >();

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
    const index = this.indexer.getSnapshot();
    // Past a `#^`, the note's own line markers are what can be completed,
    // not another note's name.
    const blockContext = getBlockCompletionContext(context.query);
    if (blockContext) {
      return this.completeBlockIds(
        index,
        blockContext,
        document,
        position,
        context.startColumn,
      );
    }
    const query = context.query.toLowerCase();
    // A note is offered by its title and by each of its aliases.
    return [...index.files.values()]
      .flatMap((file) => [
        {
          filePath: file.filePath,
          title: getNoteTitle(file.filePath),
          isAlias: false,
        },
        ...(file.aliases ?? []).map((alias) => ({
          filePath: file.filePath,
          title: alias,
          isAlias: true,
        })),
      ])
      .filter((note) => note.title.toLowerCase().includes(query))
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.filePath.localeCompare(right.filePath),
      )
      .map((note) => {
        const item = new vscode.CompletionItem(
          note.title,
          note.isAlias
            ? vscode.CompletionItemKind.Reference
            : vscode.CompletionItemKind.File,
        );
        item.detail = note.isAlias ? `Alias of ${note.filePath}` : note.filePath;
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
   * Offers the `^block-id` markers of the note a link names, so a link to a
   * line is written by picking the line rather than by remembering its id.
   */
  private completeBlockIds(
    index: WorkspaceIndex,
    context: { note: string; query: string },
    document: vscode.TextDocument,
    position: vscode.Position,
    startColumn: number,
  ): vscode.CompletionItem[] {
    const titles = createNoteTitleMap(index);
    const sourcePath = this.indexer.getFilePath?.(document.uri) ?? '';
    const filePath = resolveWikiTarget(titles, context.note, sourcePath);
    const file = filePath ? index.files.get(filePath) : undefined;
    if (!file?.blockIds) {
      return [];
    }
    const lines = file.content.split(/\r?\n/);
    const wanted = context.query.toLowerCase();
    return Object.entries(file.blockIds)
      .filter(([block]) => block.toLowerCase().includes(wanted))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([block, line]) => {
        const item = new vscode.CompletionItem(
          `^${block}`,
          vscode.CompletionItemKind.Reference,
        );
        // The line itself says more about a marker than its name does.
        item.detail = (lines[line - 1] ?? '')
          .replace(BLOCK_ID_PATTERN, '')
          .trim()
          .slice(0, 120);
        item.insertText = `^${block}]]`;
        item.range = new vscode.Range(
          position.line,
          startColumn,
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
    return measureAsync(
      'Wiki links',
      () => this.createDocumentLinks(document),
      (links) => `${links.length} links, ${document.lineCount} lines`,
    );
  }

  private resolveTarget(
    index: WorkspaceIndex,
    filePath: string,
  ): Promise<vscode.Uri | undefined> {
    let targets = this.resolvedTargets.get(index);
    if (!targets) {
      targets = new Map();
      this.resolvedTargets.set(index, targets);
    }
    let target = targets.get(filePath);
    if (!target) {
      target = resolveSourceUri(filePath);
      targets.set(filePath, target);
    }
    return target;
  }

  private async createDocumentLinks(
    document: vscode.TextDocument,
  ): Promise<vscode.DocumentLink[]> {
    const index = this.indexer.getSnapshot();
    const links = findWikiLinkTargets(
      document.getText(),
      index,
      this.indexer.getFilePath?.(document.uri),
    );
    const resolved = await Promise.all(
      links.map(async (link) => ({
        link,
        target: await this.resolveTarget(index, link.filePath),
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
      // A `#L12` fragment opens the note at the heading the link names.
      const documentLink = new vscode.DocumentLink(
        range,
        link.line ? target.with({ fragment: `L${link.line}` }) : target,
      );
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

/**
 * The note and partial id being completed past a `#^`, or nothing when the
 * caret is not in one. An empty note means the link points into the note it
 * is written in, as `[[#^id]]` does.
 */
export function getBlockCompletionContext(
  query: string,
): { note: string; query: string } | undefined {
  const caret = query.indexOf('#^');
  if (caret < 0) {
    return undefined;
  }
  return {
    note: query.slice(0, caret).trim(),
    query: query.slice(caret + 2),
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
  /**
   * One-based line the link points into: the heading a `#Heading` names or
   * the line a `#^id` marks, when the note has it.
   */
  readonly line?: number;
}

/**
 * Resolves only exact, case-insensitive title matches so duplicate note names
 * cannot make an editor link point at the wrong file. The rule is the one the
 * editor's reference counts and previews use, so all three agree.
 *
 * `sourcePath` is the note the links are written in, which `[[#Heading]]`
 * points into.
 */
export function findWikiLinkTargets(
  content: string,
  index: WorkspaceIndex,
  sourcePath?: string,
): WikiLinkTarget[] {
  const titles = createNoteTitleMap(index);
  const links: WikiLinkTarget[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  for (const match of content.matchAll(pattern)) {
    const target = parseWikiTarget(match[1]);
    const filePath =
      target.note || sourcePath
        ? resolveWikiTarget(titles, target.note, sourcePath ?? '')
        : undefined;
    if (!filePath || match.index === undefined) {
      continue;
    }

    const file = index.files.get(filePath);
    // A `#^id` names a line, a `#Heading` a section; either opens the note
    // where it points rather than at its top.
    const blockLine =
      target.block && file ? findLinkedBlock(file, target.block) : undefined;
    const section =
      target.heading && file ? findLinkedSection(file, target.heading) : undefined;
    const line = blockLine ?? section?.startLine;
    links.push({
      title: match[1].trim(),
      filePath,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      ...(line !== undefined ? { line } : {}),
    });
  }

  return links;
}
