import { isParkedFile } from '../../domain/index/parked';
import * as vscode from 'vscode';

import { BLOCK_ID_PATTERN, stripTags } from '../../domain/markdown/parser';
import { describeDay, parseDatePhrase } from '../../domain/markdown/dates';
import { readDateOptions } from '../commands/datePrompt';
import { measureAsync } from '../../shared/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  noteTitle,
  resolveWikiTarget,
} from '../../domain/index/backlinks';
import { findWikiLinkTargets } from '../../domain/index/wikiLinkTargets';
import {
  getBlockCompletionContext,
  getHeadingCompletionContext,
  getWikiLinkCompletionContext,
} from '../../domain/markdown/completionContext';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { resolveSourceUri } from '../commands/navigation';
import { frecencyScore } from '../state/frecency';
import { scoreTitle } from '../state/quickFindState';
import { whenPublished } from '../../core/workspace/publishing';

/** How often and how lately each entry was opened, which ranks the notes. */
interface AccessSource {
  readonly value: {
    sectionAccessCounts: Record<string, number>;
    sectionAccessTimes?: Record<string, number>;
  };
}


/** Where links are completed and opened: every Markdown file, narrowed to notes. */
const LINK_SELECTOR: vscode.DocumentSelector = { pattern: '**/*.md' };

interface IndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  /** The document's index key, which `[[#Heading]]` links point into. */
  getFilePath?(uri: vscode.Uri): string;
  /** Whether a file is one of the notes, not a README in a code folder. */
  isNotesFile?(uri: vscode.Uri): boolean;
}

/**
 * Completes and resolves workspace note titles inside Wiki links without
 * changing source files until the user explicitly accepts a completion item.
 */
export class WikiLinkCompletionProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];
  /**
   * Link targets resolved against one index. Resolving checks the file
   * system, and VS Code asks for links after every edit, so each note is
   * resolved once until the index changes.
   */
  private readonly resolvedTargets = new WeakMap<
    WorkspaceIndex,
    Map<string, Promise<vscode.Uri | undefined>>
  >();

  /**
   * Takes the index to complete and resolve links from, and how often each
   * entry was opened, which ranks the notes; nothing is registered until
   * `register`.
   */
  public constructor(
    private readonly indexer: IndexSource,
    private readonly access?: AccessSource,
  ) {}

  /**
   * Registers link completion after `[`, then the links that open notes,
   * for Markdown files. Returns the provider, so the composition root can
   * build and register it in one expression.
   */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCompletionItemProvider(
        LINK_SELECTOR,
        {
          provideCompletionItems: (document, position) =>
            this.provideCompletionItems(document, position),
        },
        '[',
      ),
      vscode.languages.registerDocumentLinkProvider(
        LINK_SELECTOR,
        {
          provideDocumentLinks: (document) =>
            this.provideDocumentLinks(document),
        },
      ),
    );
    return this;
  }

  /** Unregisters the completion and link providers. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /** Link completion and links belong to notes, not to every Markdown file. */
  private isNote(document: vscode.TextDocument): boolean {
    return (
      isMarkdownFile(document.uri) &&
      (this.indexer.isNotesFile?.(document.uri) ?? true)
    );
  }

  /**
   * Completes the link being typed after `[[`: a note's line markers past
   * `#^`, headings past `#`, and otherwise a day named in words and the
   * notes. Nothing is offered outside a note or an unclosed link.
   */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    if (!this.isNote(document)) {
      return [];
    }

    const line = document.lineAt(position.line).text;
    const context = getWikiLinkCompletionContext(line, position.character);
    if (!context) {
      return [];
    }

    await whenPublished(this.indexer);
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
    // One moment for the whole list: the day a date names and how lately
    // each note was opened are read against it.
    const now = Date.now();
    return [
      ...this.completeDates(context.query, range, now),
      ...this.completeNotes(index, context.query, range, now),
    ];
  }

  /**
   * Every note by its title and aliases, ranked as Find ranks them: the
   * words typed against the title, then how often and how lately the note
   * was opened, as of `now`. With nothing typed yet, the notes opened most
   * lately come first rather than whatever sorts first by name.
   */
  private completeNotes(
    index: WorkspaceIndex,
    typed: string,
    range: vscode.Range,
    now: number,
  ): vscode.CompletionItem[] {
    const query = typed.toLowerCase();
    const words = typed.trim().split(/\s+/).filter(Boolean);
    const opened = this.openedScores(index, now);
    return [...index.files.values()]
      .flatMap((file) => [
        {
          filePath: file.filePath,
          title: noteTitle(file.filePath),
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
        parked: isParkedFile(index, note.filePath),
      }))
      .filter((note) => !query || note.score > 0 || note.title.toLowerCase().includes(query))
      .sort(
        (left, right) =>
          // A parked note is still offered, after every other.
          Number(left.parked) - Number(right.parked) ||
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
        item.detail =
          (note.isAlias ? `Alias of ${note.filePath}` : note.filePath) +
          (note.parked ? ' · Parked' : '');
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
   * A day named in words, read on the day `now` falls on, as a link to that
   * day's note: `[[tomorrow` offers `[[2026-09-26]]`, with the day it
   * resolved to beside it.
   */
  private completeDates(typed: string, range: vscode.Range, now: number): vscode.CompletionItem[] {
    const words = typed.trim();
    // A written ISO date is already the note's name, which the notes offer.
    if (!words || /^\d{4}-\d{2}-\d{2}$/.test(words)) {
      return [];
    }
    const date = parseDatePhrase(words, now, readDateOptions())?.date;
    if (!date) {
      return [];
    }
    const item = new vscode.CompletionItem(date, vscode.CompletionItemKind.Value);
    item.detail = `${describeDay(date, now)}, that day's note`;
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
      const title = noteTitle(file.filePath);
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
    if (!this.isNote(document)) {
      return [];
    }

    await whenPublished(this.indexer);
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
