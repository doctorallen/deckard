import * as vscode from 'vscode';

/**
 * The few Deckard commands that rewrite many notes at once, and the way back
 * from one of them.
 *
 * Renaming or merging a tag rewrites every note that carries it, which is
 * more than an editor Undo reaches: the notes are saved, and most of them
 * were never open. Each write is shown before it lands and kept afterwards,
 * so it can be taken back as one thing.
 */

/** One note as a write found it, and as the write left it. */
export interface WrittenNote {
  uri: vscode.Uri;
  before: string;
  after: string;
}

/** What one Deckard write did, so it can be taken back. */
export interface WorkspaceWrite {
  /** What the write was, as the Undo prompt names it. */
  label: string;
  at: number;
  notes: WrittenNote[];
  /** Puts back what the write changed outside the notes, such as favorites. */
  restore?: () => Promise<void>;
}

/** What an Undo managed to put back. */
export interface UndoResult {
  label: string;
  restored: number;
  /** Notes changed since the write, which Undo leaves as they are. */
  skipped: number;
}

/**
 * The last write, and only the last: further back is what Git is for, and
 * keeping every write would keep a copy of every note it touched.
 */
export class WorkspaceWriteHistory {
  private last: WorkspaceWrite | undefined;

  public get lastWrite(): WorkspaceWrite | undefined {
    return this.last;
  }

  public remember(write: WorkspaceWrite): void {
    this.last = write.notes.length > 0 ? write : undefined;
  }

  public clear(): void {
    this.last = undefined;
  }

  /**
   * Puts every note the write changed back as it was, unless it has changed
   * again since, in which case it is left to whoever changed it.
   */
  public async undo(): Promise<UndoResult | undefined> {
    const write = this.last;
    if (!write) {
      return undefined;
    }
    const edit = new vscode.WorkspaceEdit();
    const documents: vscode.TextDocument[] = [];
    const quiet: { uri: vscode.Uri; text: string }[] = [];
    let skipped = 0;

    for (const note of write.notes) {
      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(note.uri);
      } catch {
        skipped += 1;
        continue;
      }
      // The note has to be what the write left, both on disk and in any
      // editor holding it. Either one differing means someone has been here
      // since, and an Undo is not Deckard's to make.
      if (
        document.getText() !== note.after ||
        (await readFile(note.uri)) !== note.after
      ) {
        skipped += 1;
        continue;
      }
      // A note nobody has open is written straight to disk. Going through
      // the editor would open every note an undo touches, which is a lot of
      // tabs to close after taking one thing back.
      if (isOpenInEditor(note.uri) || document.isDirty) {
        edit.replace(note.uri, wholeDocument(document), note.before);
        documents.push(document);
      } else {
        quiet.push({ uri: note.uri, text: note.before });
      }
    }

    if (documents.length > 0 && !(await vscode.workspace.applyEdit(edit))) {
      return { label: write.label, restored: 0, skipped: write.notes.length };
    }
    for (const document of documents) {
      if (document.isDirty) {
        await document.save();
      }
    }
    for (const note of quiet) {
      await vscode.workspace.fs.writeFile(
        note.uri,
        Buffer.from(note.text, 'utf8'),
      );
    }
    const restored = documents.length + quiet.length;
    if (restored > 0) {
      await write.restore?.();
    }
    this.last = undefined;
    return { label: write.label, restored, skipped };
  }
}

/** The history the commands write to, and the Undo command reads. */
export const workspaceWrites = new WorkspaceWriteHistory();

/** How a write is shown before it lands. */
export type WritePreview = 'always' | 'severalNotes' | 'never';

export function getWritePreview(): WritePreview {
  const setting = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('previewWorkspaceWrites', 'severalNotes');
  return setting === 'always' || setting === 'never'
    ? setting
    : 'severalNotes';
}

/** Whether a write of this many notes is shown first. */
export function shouldPreview(preview: WritePreview, notes: number): boolean {
  if (preview === 'never' || notes === 0) {
    return false;
  }
  return preview === 'always' || notes > 1;
}

export interface WorkspaceWriteOptions {
  /** What the write is, in the preview's heading and the Undo prompt. */
  label: string;
  /** What each changed note's row says in the preview. */
  description?: string;
  preview?: WritePreview;
  /** Puts back what the write changed outside the notes, on an Undo. */
  restore?: () => Promise<void>;
}

/**
 * Applies an edit across notes: shown first when it reaches more than one
 * note, saved once it lands, and kept as the write Undo takes back.
 *
 * VS Code's own refactor preview does the showing, so the reader reviews the
 * changes, and can leave some of them out, in the panel they already know.
 * What actually landed is read back from the notes afterwards, so leaving a
 * change out of the preview leaves it out of the Undo as well.
 */
export async function applyWorkspaceWrite(
  edit: vscode.WorkspaceEdit,
  options: WorkspaceWriteOptions,
  history: WorkspaceWriteHistory = workspaceWrites,
): Promise<{ applied: boolean; notes: WrittenNote[] }> {
  const entries = edit.entries();
  if (entries.length === 0) {
    return { applied: true, notes: [] };
  }

  const before = new Map<string, { uri: vscode.Uri; text: string }>();
  for (const [uri] of entries) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      before.set(uri.toString(), { uri, text: document.getText() });
    } catch {
      continue;
    }
  }

  const confirm = shouldPreview(
    options.preview ?? getWritePreview(),
    entries.length,
  );
  const applied = await vscode.workspace.applyEdit(
    confirm ? withConfirmation(entries, options) : edit,
    { isRefactoring: true },
  );
  if (!applied) {
    return { applied: false, notes: [] };
  }

  const notes: WrittenNote[] = [];
  for (const { uri, text } of before.values()) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.isDirty) {
      await document.save();
    }
    const after = document.getText();
    if (after !== text) {
      notes.push({ uri, before: text, after });
    }
  }

  history.remember({
    label: options.label,
    at: Date.now(),
    notes,
    ...(options.restore ? { restore: options.restore } : {}),
  });
  return { applied: true, notes };
}

/** The same edit, with every change waiting for the reader to accept it. */
function withConfirmation(
  entries: [vscode.Uri, vscode.TextEdit[]][],
  options: WorkspaceWriteOptions,
): vscode.WorkspaceEdit {
  const confirmed = new vscode.WorkspaceEdit();
  entries.forEach(([uri, edits]) => {
    edits.forEach((edit) =>
      confirmed.replace(uri, edit.range, edit.newText, {
        needsConfirmation: true,
        label: options.label,
        ...(options.description ? { description: options.description } : {}),
      }),
    );
  });
  return confirmed;
}

/**
 * Takes back the last write, after saying what it will put back.
 */
export async function undoLastWorkspaceWrite(
  refresh: () => Promise<void>,
  history: WorkspaceWriteHistory = workspaceWrites,
): Promise<UndoResult | undefined> {
  const write = history.lastWrite;
  if (!write) {
    void vscode.window.showInformationMessage(
      'Deckard has not changed your notes in this window yet.',
    );
    return undefined;
  }

  const choice = await vscode.window.showWarningMessage(
    `Undo ${write.label}?`,
    {
      modal: true,
      detail: `${countNotes(write.notes.length)} go back to what they were before Deckard changed them, at ${new Date(
        write.at,
      ).toLocaleTimeString()}. A note you have changed since is left as it is.`,
    },
    'Undo',
  );
  if (choice !== 'Undo') {
    return undefined;
  }

  const result = await history.undo();
  if (!result) {
    return undefined;
  }
  try {
    await refresh();
  } catch {
    // The watcher picks the notes up; the notes themselves are already back.
  }
  void vscode.window.showInformationMessage(
    result.skipped === 0
      ? `Undid ${result.label} in ${countNotes(result.restored)}.`
      : `Undid ${result.label} in ${countNotes(result.restored)}. ${countNotes(
          result.skipped,
        )} changed since and ${result.skipped === 1 ? 'was' : 'were'} left alone.`,
  );
  return result;
}

/** Whether a note is on screen, and so has to be written through its editor. */
function isOpenInEditor(uri: vscode.Uri): boolean {
  return vscode.window.visibleTextEditors.some(
    (editor) => editor.document.uri.toString() === uri.toString(),
  );
}

/** A note as it stands on disk, or nothing when it cannot be read. */
async function readFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(
      'utf8',
    );
  } catch {
    return undefined;
  }
}

function wholeDocument(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(
    new vscode.Position(0, 0),
    document.lineAt(Math.max(document.lineCount - 1, 0)).range.end,
  );
}

function countNotes(value: number): string {
  return `${value} ${value === 1 ? 'note' : 'notes'}`;
}
