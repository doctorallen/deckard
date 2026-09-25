import * as vscode from 'vscode';

import { BLOCK_ID_PATTERN, stripTags } from '../../core/markdown/parser';
import { describeTaskDate, parseTaskDateInput } from '../../core/markdown/taskDraft';
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
import { frecencyScore } from '../state/frecency';
import { scoreTitle } from '../state/quickFindState';

/** How often and how lately each entry was opened, which ranks the notes. */
interface AccessSource {
  readonly value: {
    sectionAccessCounts: Record<string, number>;
    sectionAccessTimes?: Record<string, number>;
  };
}

/** A date named in words inside `[[`, which links to that day's note. */
const DATE_WORDS = /^(?:today|tomorrow|yesterday|(?:next[ \t]+)?(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*|in[ \t]+\d+[ \t]*[a-z]+|[+]\d+[dwm])$/i;

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

  public constructor(
    private readonly indexer: IndexSource,
    private readonly access?: AccessSource,
  ) {
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
    const range = new vscode.Range(
      position.line,
      context.startColumn,
      position.line,
      position.character,
    );
    // Past a `#`, the headings: of the note named, of this note when none
    // is, or of every note after `##`.
    const headingContext = getHeadingCompletionContext(context.query);
    if (headingContext) {
      return this.completeHeadings(index, headingContext, document, range);
    }
    return [
      ...this.completeDates(context.query, range),
      ...this.completeNotes(index, context.query, range),
    ];
  }

  /**
   * Every note by its title and aliases, ranked as Find ranks them: the
   * words typed against the title, then how often and how lately the note
   * was opened. With nothing typed yet, the notes opened most lately come
   * first rather than whatever sorts first by name.
   */
  private completeNotes(
    index: WorkspaceIndex,
    typed: string,
    range: vscode.Range,
  ): vscode.CompletionItem[] {
    const query = typed.toLowerCase();
    const words = typed.trim().split(/\s+/).filter(Boolean);
    const now = Date.now();
    const opened = this.openedScores(index, now);
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
      .map((note) => ({
        ...note,
        score: words.length ? scoreTitle(words, note.title) : 0,
        opened: opened.get(note.filePath) ?? 0,
      }))
      .filter((note) => !query || note.score > 0 || note.title.toLowerCase().includes(query))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.opened - left.opened ||
          left.title.localeCompare(right.title) ||
          left.filePath.localeCompare(right.filePath),
      )
      .map((note, rank) => {
        const item = new vscode.CompletionItem(
          note.title,
          note.isAlias
            ? vscode.CompletionItemKind.Reference
            : vscode.CompletionItemKind.File,
        );
        item.detail = note.isAlias ? `Alias of ${note.filePath}` : note.filePath;
        item.insertText = `${note.title}]]`;
        // VS Code sorts completions itself; the rank above is kept by giving
        // each its place, and every title passes its filter.
        item.sortText = String(rank).padStart(5, '0');
        item.filterText = typed;
        item.range = range;
        return item;
      });
  }

  /** How often and how lately each note was opened, summed over its entries. */
  private openedScores(index: WorkspaceIndex, now: number): Map<string, number> {
    const scores = new Map<string, number>();
    const access = this.access?.value;
    if (!access) {
      return scores;
    }
    for (const [sectionId, count] of Object.entries(access.sectionAccessCounts)) {
      const section = index.sections.get(sectionId);
      if (!section) {
        continue;
      }
      scores.set(
        section.filePath,
        (scores.get(section.filePath) ?? 0) +
          frecencyScore(count, access.sectionAccessTimes?.[sectionId], now),
      );
    }
    return scores;
  }

  /**
   * A day named in words, as a link to that day's note: `[[tomorrow` offers
   * `[[2026-09-26]]`, with the day it resolved to beside it.
   */
  private completeDates(typed: string, range: vscode.Range): vscode.CompletionItem[] {
    const words = typed.trim();
    if (!DATE_WORDS.test(words)) {
      return [];
    }
    const date = parseTaskDateInput(words)?.date;
    if (!date) {
      return [];
    }
    const item = new vscode.CompletionItem(date, vscode.CompletionItemKind.Value);
    item.detail = `${describeTaskDate(date)}, that day's note`;
    item.insertText = `${date}]]`;
    item.filterText = typed;
    item.sortText = '!';
    item.range = range;
    return [item];
  }

  /**
   * The headings of a note, written as a link names them: tags taken out,
   * as `[[Note#Heading]]` resolves them.
   */
  private completeHeadings(
    index: WorkspaceIndex,
    context: { note: string | undefined; query: string },
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CompletionItem[] {
    const titles = createNoteTitleMap(index);
    const sourcePath = this.indexer.getFilePath?.(document.uri) ?? '';
    const files =
      context.note === undefined
        ? [...index.files.values()]
        : [index.files.get(
            context.note
              ? resolveWikiTarget(titles, context.note, sourcePath) ?? ''
              : sourcePath,
          )].filter((file): file is NonNullable<typeof file> => file !== undefined);
    const words = context.query.trim().split(/\s+/).filter(Boolean);
    const seen = new Set<string>();
    const found: { title: string; heading: string; filePath: string; score: number }[] = [];
    for (const file of files) {
      const title = getNoteTitle(file.filePath);
      for (const section of file.sections) {
        if (section.isInline) {
          continue;
        }
        const heading = stripTags(section.heading).replace(/\s+/g, ' ').trim();
        const key = `${file.filePath}#${heading.toLowerCase()}`;
        if (!heading || seen.has(key)) {
          continue;
        }
        const score = words.length ? scoreTitle(words, heading) : 1;
        if (score <= 0) {
          continue;
        }
        seen.add(key);
        found.push({ title, heading, filePath: file.filePath, score });
      }
    }
    return found
      .sort((left, right) => right.score - left.score)
      .slice(0, 200)
      .map((entry, rank) => {
        const item = new vscode.CompletionItem(
          context.note === undefined ? `${entry.title}#${entry.heading}` : entry.heading,
          vscode.CompletionItemKind.Reference,
        );
        item.detail = entry.filePath;
        // A heading in this note needs no note name; one found across notes
        // takes its note's.
        const target = context.note === undefined
          ? `${entry.title}#${entry.heading}`
          : `${context.note}#${entry.heading}`;
        item.insertText = `${target}]]`;
        item.filterText = `${context.note === undefined ? '##' : `${context.note}#`}${context.query}`;
        item.sortText = String(rank).padStart(5, '0');
        item.range = range;
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
 * The note and partial heading being completed past a `#`, or nothing when
 * the caret is not past one. `##words` searches every note's headings, which
 * is a note of `undefined`; `#words` is the note the link is written in.
 */
export function getHeadingCompletionContext(
  query: string,
): { note: string | undefined; query: string } | undefined {
  if (query.includes('#^')) {
    return undefined;
  }
  if (query.startsWith('##')) {
    return { note: undefined, query: query.slice(2) };
  }
  const hash = query.indexOf('#');
  if (hash < 0) {
    return undefined;
  }
  return { note: query.slice(0, hash).trim(), query: query.slice(hash + 1) };
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
