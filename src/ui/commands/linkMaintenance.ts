import * as vscode from 'vscode';
import { describeRejectedEdit, noteName, reportFailure } from './notify';

import { pluralize, withoutByteOrderMark } from '../../shared/text';
import { LinkRewrite } from '../../domain/links/linkRewrites';
import { noteTitle } from '../../domain/index/backlinks';
import { findHeadingAtLine } from '../../domain/notes/headingLookup';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { checkRewrites, LinkService } from '../../services/linkService';
import { createLinkService, toWorkspaceEdit, vscodeLiveNotes } from './linkMaintenancePorts';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { WorkspaceIndex } from '../../domain/model';

/**
 * The commands and the rename listener that keep `[[links]]` pointing where
 * they pointed before a note or a heading was renamed. Which links follow
 * is LinkService's decision; these ask, write, and report.
 */

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
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
  const { edits, applied } = await checkRewrites(vscodeLiveNotes, rewrites);
  return { edit: toWorkspaceEdit(edits), applied };
}

/** The two rename events LinkMaintenance follows: VS Code's, or a test's. */
export type RenameEvents = Pick<typeof vscode.workspace, 'onWillRenameFiles' | 'onDidRenameFiles'>;

/** One rename's files, the same whether VS Code is about to make it or has made it. */
type RenamedFiles = readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[];

/**
 * Follows note renames, rewriting the links that named the note by its old
 * title.
 *
 * The edit is handed back to VS Code as part of the rename, so the links and
 * the rename land together and one Undo takes back both. How many links it
 * rewrote is said once the rename is made, so a rename that is cancelled or
 * fails says nothing.
 */
export class LinkMaintenance implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /**
   * What each planned rename's message will say, by its files, until VS Code
   * says the rename is made. A rename that is never made leaves its entry,
   * which the same rename planned again replaces.
   */
  private readonly unreported = new Map<string, string>();

  /**
   * Listens for renames on `events`, VS Code's by default; `links` plans the
   * rewrites, over `indexer`'s notes by default.
   */
  public constructor(
    private readonly indexer: IndexSource,
    private readonly links: LinkService<vscode.Uri> = createLinkService(indexer),
    events: RenameEvents = vscode.workspace,
  ) {
    this.disposables.push(
      events.onWillRenameFiles((event) => {
        if (!isEnabled()) {
          return;
        }
        event.waitUntil(this.planRenames(event.files));
      }),
      events.onDidRenameFiles((event) => {
        const key = renameKey(event.files);
        const message = this.unreported.get(key);
        this.unreported.delete(key);
        if (message) {
          void vscode.window.showInformationMessage(message);
        }
      }),
    );
  }

  /** Stops following renames. */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * The edit that keeps links pointing at the notes being renamed, for the
   * renames that change a note's title. How many it rewrote is kept, to be
   * said once VS Code has made the rename.
   */
  public async planRenames(files: RenamedFiles): Promise<vscode.WorkspaceEdit> {
    await this.indexer.ready;
    const renames = files
      .filter(
        ({ oldUri, newUri }) =>
          isMarkdownFile(oldUri) &&
          isMarkdownFile(newUri) &&
          this.indexer.isNotesFile(oldUri),
      )
      .map(({ oldUri, newUri }) => ({
        fromPath: this.indexer.getFilePath(oldUri),
        toTitle: noteTitle(this.indexer.getFilePath(newUri)),
      }));
    const plan = await this.links.planNoteRenames(renames, (filePath) =>
      this.readOpenNote(filePath),
    );
    const key = renameKey(files);
    if (plan.rewritten > 0) {
      this.unreported.set(
        key,
        `Deckard updated ${pluralize(plan.rewritten, 'link', 'links')} in ${pluralize(
          plan.notes,
          'note',
          'notes',
        )}.`,
      );
    } else {
      this.unreported.delete(key);
    }
    return toWorkspaceEdit(plan.edits);
  }

  /** A note as the editor has it, when it is open. */
  private readOpenNote(filePath: string): string | undefined {
    const open = vscode.workspace.textDocuments.find(
      (document) =>
        isMarkdownFile(document.uri) &&
        this.indexer.getFilePath(document.uri) === filePath,
    );
    return open?.getText();
  }
}

/**
 * Renames the heading the cursor sits in and carries every `[[Note#Heading]]`
 * link to it along, then saves the notes it changed.
 */
export async function renameHeadingCommand(
  indexer: IndexSource & { refresh(): Promise<void> },
  history: WorkspaceWriteHistory,
  links: LinkService<vscode.Uri> = createLinkService(indexer),
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
  // The index can hold the text with a byte order mark the editor leaves
  // out, which is no difference the reader made.
  if (!file || editor.document.getText() !== withoutByteOrderMark(file.content)) {
    offerSaveFirst(editor.document, indexer);
    return undefined;
  }

  const heading = section.heading.trim();
  const next = await askForHeading(heading);
  if (next === undefined || next.trim() === heading) {
    return undefined;
  }

  const plan = await links.planHeadingRename({
    index,
    filePath,
    uri: editor.document.uri,
    text: editor.document.getText(),
    section,
    from: heading,
    to: next.trim(),
  });
  if (plan.kind === 'no-heading-line') {
    return undefined;
  }

  const written = await history.write(toWorkspaceEdit(plan.edits), {
    label: `the rename of the heading "${heading}"`,
    description: `Rename the heading to "${next.trim()}"`,
    // Putting back the heading without its links, or the links without
    // it, would break every link it renamed.
    together: true,
  });
  if (!written.applied) {
    void reportFailure(describeRejectedEdit(noteName(editor.document.uri)));
    return undefined;
  }
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the notes up; the rename itself is already saved.
  }
  reportHeadingRenamed(next.trim(), written.notes.length - 1);
  return next.trim();
}

/**
 * Asks for the note to be saved first, since the links are rewritten from
 * what is on disk, and renames once it is.
 */
function offerSaveFirst(
  document: vscode.TextDocument,
  indexer: { refresh(): Promise<void> },
): void {
  void vscode.window
    .showInformationMessage(
      'Save this note before renaming its heading, so Deckard rewrites the links from what is on disk.',
      'Save and Rename',
    )
    .then(async (choice) => {
      if (choice !== 'Save and Rename' || !(await document.save())) {
        return;
      }
      await indexer.refresh();
      await vscode.commands.executeCommand('deckard.renameHeading');
    });
}

/** The heading's new text, on one line, or undefined when the box is closed. */
function askForHeading(heading: string): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Rename heading',
    prompt: 'Links written as [[Note#Heading]] follow the new text.',
    value: heading,
    validateInput: (value) =>
      value.trim() && !value.includes('\n')
        ? undefined
        : 'Write the heading on one line.',
  });
}

/** Says the heading is renamed, and in how many other notes its links are. */
function reportHeadingRenamed(heading: string, others: number): void {
  void vscode.window.showInformationMessage(
    others <= 0
      ? `Renamed the heading to "${heading}".`
      : `Renamed the heading to "${heading}" and the links to it in ${pluralize(
          others,
          'other note',
          'other notes',
        )}.`,
  );
}

/** One rename's files as text, so the rename VS Code made is matched to the one planned. */
function renameKey(files: RenamedFiles): string {
  return files.map(({ oldUri, newUri }) => `${oldUri.toString()} ${newUri.toString()}`).join('\n');
}

/** Whether renaming a note carries its links along, as the setting says. */
function isEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('updateLinksOnRename', true);
}
