import * as vscode from 'vscode';

import { findFencedLines, stripTags } from '../../core/markdown/parser';
import { measure } from '../../core/timing';
import { Section, WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  normalizeHeading,
  noteTitle,
  resolveWikiTarget,
} from '../../core/workspace/backlinks';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { resolveSourceUri } from './navigation';

/**
 * Keeps `[[links]]` pointing where they pointed before a note or a heading was
 * renamed.
 *
 * A link names its target by text, so renaming a note breaks every link to it
 * and renaming a heading breaks every link into that heading. Link diagnostics
 * report the breakage afterwards; these rewrites prevent it, in the same undo
 * step as the rename that would have caused it.
 */

/** One `[[link]]` to rewrite, in the note that writes it. */
export interface LinkRewrite {
  /** The note holding the link. */
  filePath: string;
  /** Zero-based line, and the columns of the whole `[[…]]`. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The whole `[[…]]` as it is written now. */
  from: string;
  /** The whole `[[…]]` as it should read. */
  text: string;
}

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
}

const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * What a link is made of, so a rewrite can change the note it names and leave
 * everything the author wrote around it alone.
 */
interface LinkParts {
  /** The note name, as written. */
  note: string;
  /** The `#Heading` or `#^id` after the name, as written, caret included. */
  fragment?: string;
  /** The text after `|`, as written. */
  display?: string;
}

/**
 * Rewrites every link that names a note by the title it is losing, so the
 * links follow it to its new name.
 *
 * Only links that resolve to the renamed note are touched, so a link to
 * another note that happens to share the name, or one written through an
 * alias the note keeps, is left as it is.
 */
export function planNoteRenameRewrites(
  index: WorkspaceIndex,
  fromPath: string,
  toTitle: string,
  contentOf: (filePath: string) => string | undefined = (filePath) =>
    index.files.get(filePath)?.content,
): LinkRewrite[] {
  const fromTitle = noteTitle(fromPath).toLocaleLowerCase();
  if (!fromTitle || noteTitle(fromPath) === toTitle) {
    return [];
  }
  const titles = createNoteTitleMap(index);
  return findRewrites(index, contentOf, (parts, sourcePath) => {
    if (parts.note.trim().toLocaleLowerCase() !== fromTitle) {
      return undefined;
    }
    return resolveWikiTarget(titles, parts.note, sourcePath) === fromPath
      ? { ...parts, note: toTitle }
      : undefined;
  });
}

/**
 * Rewrites every link that names one heading of one note, so the links follow
 * the heading's new text. A link to the note itself, without a `#`, already
 * points where it should and is left alone.
 */
export function planHeadingRenameRewrites(
  index: WorkspaceIndex,
  filePath: string,
  fromHeading: string,
  toHeading: string,
  contentOf: (path: string) => string | undefined = (path) =>
    index.files.get(path)?.content,
): LinkRewrite[] {
  const wanted = normalizeHeading(fromHeading);
  const next = stripTags(toHeading).replace(/\s+/g, ' ').trim();
  if (!wanted || !next || wanted === normalizeHeading(toHeading)) {
    return [];
  }
  const titles = createNoteTitleMap(index);
  return findRewrites(index, contentOf, (parts, sourcePath) => {
    const fragment = parts.fragment;
    if (
      !fragment ||
      fragment.startsWith('^') ||
      normalizeHeading(fragment) !== wanted
    ) {
      return undefined;
    }
    const target = parts.note
      ? resolveWikiTarget(titles, parts.note, sourcePath)
      : sourcePath;
    return target === filePath ? { ...parts, fragment: next } : undefined;
  });
}

/**
 * Walks every note's links once and keeps the ones a caller rewrites. Links
 * inside code fences are left alone, the way every other pass over note
 * source leaves them.
 */
function findRewrites(
  index: WorkspaceIndex,
  contentOf: (filePath: string) => string | undefined,
  rewrite: (parts: LinkParts, sourcePath: string) => LinkParts | undefined,
): LinkRewrite[] {
  const rewrites: LinkRewrite[] = [];
  index.files.forEach((_file, sourcePath) => {
    const content = contentOf(sourcePath);
    if (content === undefined) {
      return;
    }
    const lines = content.split(/\r?\n/);
    const fenced = findFencedLines(lines);
    lines.forEach((text, line) => {
      if (fenced.has(line)) {
        return;
      }
      for (const match of text.matchAll(WIKI_LINK)) {
        const parts = readLinkParts(match[1], match[2]);
        const next = rewrite(parts, sourcePath);
        if (!next || match.index === undefined) {
          continue;
        }
        rewrites.push({
          filePath: sourcePath,
          line,
          startColumn: match.index,
          endColumn: match.index + match[0].length,
          from: match[0],
          text: writeLink(next),
        });
      }
    });
  });
  return rewrites;
}

function readLinkParts(target: string, display?: string): LinkParts {
  const hash = target.indexOf('#');
  return {
    note: hash < 0 ? target.trim() : target.slice(0, hash).trim(),
    ...(hash < 0 ? {} : { fragment: target.slice(hash + 1).trim() }),
    ...(display === undefined ? {} : { display }),
  };
}

function writeLink(parts: LinkParts): string {
  const fragment = parts.fragment ? `#${parts.fragment}` : '';
  const display = parts.display === undefined ? '' : `|${parts.display}`;
  return `[[${parts.note}${fragment}${display}]]`;
}

/** The notes a set of rewrites touches, and how many links each one holds. */
export function countRewrittenNotes(rewrites: readonly LinkRewrite[]): number {
  return new Set(rewrites.map((rewrite) => rewrite.filePath)).size;
}

/**
 * Turns rewrites into one workspace edit, reading each note as it stands now
 * rather than as it was indexed.
 *
 * A line that no longer holds the link that was planned is left alone, so an
 * edit made between planning and applying is never overwritten.
 */
export async function createLinkRewriteEdit(
  rewrites: readonly LinkRewrite[],
): Promise<{ edit: vscode.WorkspaceEdit; applied: LinkRewrite[] }> {
  const edit = new vscode.WorkspaceEdit();
  const applied: LinkRewrite[] = [];
  const byFile = new Map<string, LinkRewrite[]>();
  rewrites.forEach((rewrite) => {
    byFile.set(rewrite.filePath, [
      ...(byFile.get(rewrite.filePath) ?? []),
      rewrite,
    ]);
  });

  for (const [filePath, fileRewrites] of byFile) {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      continue;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      continue;
    }
    fileRewrites.forEach((rewrite) => {
      if (rewrite.line >= document.lineCount) {
        return;
      }
      const range = new vscode.Range(
        rewrite.line,
        rewrite.startColumn,
        rewrite.line,
        rewrite.endColumn,
      );
      // The planned link has to still be there, character for character.
      // Anything else means the note moved on, and rewriting it would undo
      // whoever moved it.
      if (document.getText(range) !== rewrite.from) {
        return;
      }
      edit.replace(uri, range, rewrite.text);
      applied.push(rewrite);
    });
  }

  return { edit, applied };
}

/** Applies rewrites and saves the notes they changed. */
export async function applyLinkRewrites(
  rewrites: readonly LinkRewrite[],
): Promise<number> {
  const { edit, applied } = await createLinkRewriteEdit(rewrites);
  if (applied.length === 0) {
    return 0;
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    return 0;
  }
  for (const uri of edit.entries().map(([entryUri]) => entryUri)) {
    const document = vscode.workspace.textDocuments.find(
      (open) => open.uri.toString() === uri.toString(),
    );
    if (document?.isDirty) {
      await document.save();
    }
  }
  return applied.length;
}

/**
 * Follows note renames, rewriting the links that named the note by its old
 * title.
 *
 * The edit is handed back to VS Code as part of the rename, so the links and
 * the rename land together and one Undo takes back both.
 */
export class LinkMaintenance implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly indexer: IndexSource) {
    this.disposables.push(
      vscode.workspace.onWillRenameFiles((event) => {
        if (!isEnabled()) {
          return;
        }
        event.waitUntil(this.planRenames(event.files));
      }),
    );
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * The edit that keeps links pointing at the notes being renamed, for the
   * renames that change a note's title.
   */
  public async planRenames(
    files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[],
  ): Promise<vscode.WorkspaceEdit> {
    const edit = new vscode.WorkspaceEdit();
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    let rewritten = 0;
    let notes = 0;

    for (const { oldUri, newUri } of files) {
      if (
        !isMarkdownFile(oldUri) ||
        !isMarkdownFile(newUri) ||
        !this.indexer.isNotesFile(oldUri)
      ) {
        continue;
      }
      const fromPath = this.indexer.getFilePath(oldUri);
      const toTitle = noteTitle(this.indexer.getFilePath(newUri));
      if (!index.files.has(fromPath)) {
        continue;
      }
      const rewrites = measure(
        'Plan rename link rewrites',
        () =>
          planNoteRenameRewrites(index, fromPath, toTitle, (filePath) =>
            this.readNote(index, filePath),
          ),
        (planned) => `${planned.length} links, ${index.files.size} notes`,
      );
      // The edit is applied before the file moves, so every rewrite names
      // the note where it is now, the renamed note included.
      const { edit: fileEdit, applied } = await createLinkRewriteEdit(rewrites);
      fileEdit.entries().forEach(([uri, edits]) => {
        edits.forEach((textEdit) =>
          edit.replace(uri, textEdit.range, textEdit.newText),
        );
      });
      rewritten += applied.length;
      notes += countRewrittenNotes(applied);
    }

    if (rewritten > 0) {
      void vscode.window.showInformationMessage(
        `Deckard updated ${count(rewritten, 'link', 'links')} in ${count(
          notes,
          'note',
          'notes',
        )}.`,
      );
    }
    return edit;
  }

  /** A note as the editor has it, when it is open, and as indexed otherwise. */
  private readNote(
    index: WorkspaceIndex,
    filePath: string,
  ): string | undefined {
    const file = index.files.get(filePath);
    if (!file) {
      return undefined;
    }
    const open = vscode.workspace.textDocuments.find(
      (document) =>
        isMarkdownFile(document.uri) &&
        this.indexer.getFilePath(document.uri) === filePath,
    );
    return open ? open.getText() : file.content;
  }
}

/**
 * Renames the heading the cursor sits in and carries every `[[Note#Heading]]`
 * link to it along, then saves the notes it changed.
 */
export async function renameHeadingCommand(
  indexer: IndexSource & { refresh(): Promise<void> },
): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownFile(editor.document.uri)) {
    void vscode.window.showInformationMessage(
      'Open a note to rename one of its headings.',
    );
    return undefined;
  }

  await indexer.ready;
  const index = indexer.getSnapshot();
  const filePath = indexer.getFilePath(editor.document.uri);
  const file = index.files.get(filePath);
  const section = file
    ? findHeadingAtLine(file.sections, editor.selection.active.line + 1)
    : undefined;
  if (!section) {
    void vscode.window.showInformationMessage(
      'Put the cursor in a heading to rename it.',
    );
    return undefined;
  }
  if (editor.document.getText() !== file?.content) {
    void vscode.window.showWarningMessage(
      'Save this note before renaming its heading, so Deckard rewrites the links from what is on disk.',
    );
    return undefined;
  }

  const heading = section.heading.trim();
  const next = await vscode.window.showInputBox({
    title: 'Rename heading',
    prompt: 'Links written as [[Note#Heading]] follow the new text.',
    value: heading,
    validateInput: (value) =>
      value.trim() && !value.includes('\n')
        ? undefined
        : 'Enter the heading on one line.',
  });
  if (next === undefined || next.trim() === heading) {
    return undefined;
  }

  const rewrites = planHeadingRenameRewrites(
    index,
    filePath,
    heading,
    next.trim(),
    (path) =>
      path === filePath ? editor.document.getText() : index.files.get(path)?.content,
  );
  const line = editor.document.lineAt(section.startLine - 1);
  const marks = /^\s*(#+)\s*/.exec(line.text);
  if (!marks) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    editor.document.uri,
    new vscode.Range(
      section.startLine - 1,
      marks[0].length,
      section.startLine - 1,
      line.text.length,
    ),
    next.trim(),
  );
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(
      'Deckard could not rename the heading. VS Code rejected the source edit.',
    );
    return undefined;
  }
  await editor.document.save();

  const updated = await applyLinkRewrites(rewrites);
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the notes up; the rename itself is already saved.
  }
  void vscode.window.showInformationMessage(
    updated === 0
      ? `Renamed the heading to "${next.trim()}".`
      : `Renamed the heading to "${next.trim()}" and updated ${count(
          updated,
          'link',
          'links',
        )}.`,
  );
  return next.trim();
}

/** The innermost heading a one-based line sits in. */
export function findHeadingAtLine(
  sections: readonly Section[],
  line: number,
): Section | undefined {
  return sections
    .filter(
      (section) =>
        !section.isInline && section.startLine <= line && section.endLine >= line,
    )
    .sort(
      (left, right) =>
        right.startLine - left.startLine ||
        right.headingLevel - left.headingLevel,
    )[0];
}

function isEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('updateLinksOnRename', true);
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
