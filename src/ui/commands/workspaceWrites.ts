import * as vscode from 'vscode';
import { pluralize } from '../../shared/text';
import { WriteHistory, WriteMark } from '../../core/workspace/writeHistory';
import { Failure, noteName, reportFailure, reportStale } from './notify';

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
  /** Whether its notes go back together or not at all, as WorkspaceWriteOptions says. */
  together?: boolean;
}

/** What an Undo managed to put back. */
export interface UndoResult {
  label: string;
  restored: number;
  /**
   * Notes Undo left as they are: those changed since the write, or every
   * note when VS Code refused the Undo's edit. For a write whose notes go
   * back together, the notes that changed since, which kept all of them
   * from going back.
   */
  skipped: number;
  /** Which notes those are, so a message can name them. */
  skippedUris: vscode.Uri[];
  /**
   * The notes whose edit VS Code refused, when it refused it. Nothing was
   * written then, and the write is kept, so the Undo can be tried again.
   */
  refused?: vscode.Uri[];
}

/**
 * Deckard's writes to the notes and the way back from them: core's
 * WriteHistory keeps the last write and the notes just saved, and this
 * makes a write through VS Code's edits, reads back what landed, and takes
 * it back again.
 *
 * One is created where the extension starts and handed to every command
 * that writes to the notes and to Undo Last Change, so what one command
 * wrote is what another's Undo sees, and a test builds its own.
 */
export class WorkspaceWriteHistory extends WriteHistory<WorkspaceWrite> {
  /** The write or Undo running now; the next waits for it. */
  private turn: Promise<unknown> = Promise.resolve();

  /**
   * Puts every note the write changed back as it was, unless it has changed
   * again since, in which case it is left to whoever changed it. Given
   * `mine`, it takes back nothing once that write is no longer the last,
   * judged when its turn comes, after any write still landing.
   */
  public undo(mine?: WriteMark): Promise<UndoResult | undefined> {
    return this.inTurn(() => (mine && !mine.isLatest() ? Promise.resolve(undefined) : this.undoLatest()));
  }

  /**
   * Runs `job` once every write and Undo asked for before it has finished.
   * Each reads the notes, applies its edit, and reads them again across
   * several awaits; two at once would each read what the other was
   * changing, and the Undo of the last would take back both.
   */
  private inTurn<T>(job: () => Promise<T>): Promise<T> {
    const run = this.turn.then(job, job);
    this.turn = run.catch(() => undefined);
    return run;
  }

  /** Takes back the last write, as `undo` says. */
  private async undoLatest(): Promise<UndoResult | undefined> {
    const write = this.lastWrite;
    if (!write) {
      return undefined;
    }
    const plan = await planUndo(write.notes);
    if (write.together && plan.skippedUris.length > 0) {
      // Putting back only some of them would undo half of one change, such
      // as a task taken out of its note and never put back. The write is
      // kept, so the Undo can be tried again once the note is put back.
      return {
        label: write.label,
        restored: 0,
        skipped: plan.skippedUris.length,
        skippedUris: plan.skippedUris,
      };
    }
    if (!(await applyUndo(plan))) {
      return {
        label: write.label,
        restored: 0,
        skipped: write.notes.length,
        skippedUris: write.notes.map((note) => note.uri),
        refused: plan.documents.map((document) => document.uri),
      };
    }
    const restored = plan.documents.length + plan.quiet.length;
    if (restored > 0) {
      await write.restore?.();
    }
    this.clear();
    return { label: write.label, restored, skipped: plan.skippedUris.length, skippedUris: plan.skippedUris };
  }

  /**
   * Applies an edit across notes: shown first when it reaches more than one
   * note, saved once it lands, and kept as the write Undo takes back.
   *
   * VS Code's own refactor preview does the showing, so the reader reviews
   * the changes, and can leave some of them out, in the panel they already
   * know. What actually landed is read back from the notes afterwards, so
   * leaving a change out of the preview leaves it out of the Undo as well.
   * A write that lands returns the handle its Undo button works through.
   * Writes take turns, so one asked for while another lands starts from
   * the notes as that one left them.
   */
  public write(
    edit: vscode.WorkspaceEdit,
    options: WorkspaceWriteOptions,
  ): Promise<WorkspaceWriteResult> {
    return this.inTurn(() => this.writeNow(edit, options));
  }

  /** Makes one write, as `write` says, once its turn has come. */
  private async writeNow(
    edit: vscode.WorkspaceEdit,
    options: WorkspaceWriteOptions,
  ): Promise<WorkspaceWriteResult> {
    const entries = edit.entries();
    if (entries.length === 0) {
      return { applied: true, notes: [], handle: this.createHandle() };
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
        this.ownWrites.note(document.uri.toString());
        await document.save();
      }
      const after = document.getText();
      if (after !== text) {
        notes.push({ uri, before: text, after });
      }
    }

    this.remember({
      label: options.label,
      at: Date.now(),
      notes,
      ...(options.restore ? { restore: options.restore } : {}),
      ...(options.together ? { together: true } : {}),
    });
    return { applied: true, notes, handle: this.createHandle() };
  }

  /**
   * Undo Last Change: takes back the last write, whatever wrote it, after
   * saying what it will put back, then reads the notes again with `refresh`.
   * Given `mine`, the write a message's Undo is for, it takes back nothing
   * once Deckard has written since, even while the question was open.
   */
  public async undoLast(
    refresh: () => Promise<void>,
    mine?: WriteMark,
  ): Promise<UndoResult | undefined> {
    const write = this.lastWrite;
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
        detail: `${pluralize(write.notes.length, 'note')} go back to what they were before Deckard changed them, at ${new Date(
          write.at,
        ).toLocaleTimeString()}. ${
          write.together
            ? 'They go back together, so if you have changed one since, none is put back.'
            : 'A note you have changed since is left as it is.'
        }`,
      },
      'Undo',
    );
    if (choice !== 'Undo') {
      return undefined;
    }
    if (mine && !mine.isLatest()) {
      reportWrittenSince();
      return undefined;
    }

    const result = await this.undo(mine);
    if (!result) {
      if (mine) {
        // A write landed while the Undo waited its turn.
        reportWrittenSince();
      }
      return undefined;
    }
    try {
      await refresh();
    } catch {
      // The watcher picks the notes up; the notes themselves are already back.
    }
    reportUndo(result, `Undid ${result.label} in ${pluralize(result.restored, 'note')}.`);
    return result;
  }

  /** The handle for the write that is last now. */
  private createHandle(): WriteHandle {
    return new Handle(this, this.mark());
  }
}

/** What an Undo says once it is done, or how to word it from what it put back. */
export type UndoDone = string | ((result: UndoResult | undefined) => string);

/**
 * How an Undo button takes a write back once pressed. Either way it takes
 * the write back only while it is still the last: once Deckard has written
 * since, it says to use Undo Last Change and writes nothing, since the
 * write it would take back is no longer the one the message named.
 */
export type UndoOffer =
  /**
   * Takes the write back, then reads the notes again with `refresh` when
   * given, whose failure is ignored, and says `done`. A rollover and a
   * review read them again; the rest leave it to the watcher.
   */
  | { guard: 'latest'; done: UndoDone; refresh?: () => Promise<void> }
  /**
   * As Undo Last Change does: it asks first, takes the write back, and
   * reads the notes again with `refresh`. Park Note's Undo, which ran that
   * command.
   */
  | { guard: 'ask'; refresh: () => Promise<void> };

/** A button a message offers before its Undo, such as Open. */
export interface UndoOfferAction {
  label: string;
  run: () => Promise<void>;
}

/**
 * One write, as its command holds it after it lands: whether it is still the
 * write an Undo takes back, and the Undo itself, so no command compares the
 * history's last write or runs the Undo command to take its write back.
 */
export interface WriteHandle extends WriteMark {
  /**
   * Takes this write back while it is still the last. Nothing, and nothing
   * written, once Deckard has written since or when it changed no note.
   */
  undo(): Promise<UndoResult | undefined>;
  /** What the Undo button on this write does when pressed, as `offer` says. */
  takeBack(offer: UndoOffer): Promise<void>;
  /**
   * Says `message` with an Undo button, after `also` when there is one,
   * and takes the write back as `offer` says when Undo is chosen.
   */
  offerUndo(message: string, offer: UndoOffer, also?: UndoOfferAction): void;
}

/** The result of a write: whether it landed, what it changed, and its handle. */
export type WorkspaceWriteResult =
  | { applied: false; notes: WrittenNote[] }
  | { applied: true; notes: WrittenNote[]; handle: WriteHandle };

/** A write's handle, on the history it was written to. */
class Handle implements WriteHandle {
  /** A handle for the write `mine` marks, taken back through `history`. */
  public constructor(
    private readonly history: WorkspaceWriteHistory,
    private readonly mine: WriteMark,
  ) {}

  /** Whether nothing has been written since this write. */
  public isLatest(): boolean {
    return this.mine.isLatest();
  }

  /** Takes this write back while it is still the last; undefined once Deckard has written since. */
  public async undo(): Promise<UndoResult | undefined> {
    return this.history.undo(this.mine);
  }

  /** The Undo button, pressed: takes the write back the way `offer.guard` says. */
  public async takeBack(offer: UndoOffer): Promise<void> {
    if (!this.isLatest()) {
      reportWrittenSince();
      return;
    }
    if (offer.guard === 'ask') {
      await this.history.undoLast(offer.refresh, this);
      return;
    }
    const result = await this.undo();
    if (offer.refresh) {
      try {
        await offer.refresh();
      } catch {
        // The watcher picks the notes up; the notes themselves are back.
      }
    }
    reportUndo(result, typeof offer.done === 'string' ? offer.done : offer.done(result));
  }

  /** Shows `message` with `also`'s button, then Undo; neither is waited for. */
  public offerUndo(message: string, offer: UndoOffer, also?: UndoOfferAction): void {
    void vscode.window
      .showInformationMessage(message, ...(also ? [also.label] : []), 'Undo')
      .then(async (choice) => {
        if (also && choice === also.label) {
          await also.run();
          return;
        }
        if (choice === 'Undo') {
          await this.takeBack(offer);
        }
      });
  }
}

/** How an Undo puts each note back, decided before anything is written. */
interface UndoPlan {
  /** The edit for the notes put back through their editors. */
  edit: vscode.WorkspaceEdit;
  /** The notes in that edit, saved once it lands. */
  documents: vscode.TextDocument[];
  /**
   * The notes nobody has open, written straight to disk, each with the
   * byte order mark it had there.
   */
  quiet: { uri: vscode.Uri; text: string; byteOrderMark: boolean }[];
  /** The notes changed since the write, or unreadable, which are left alone. */
  skippedUris: vscode.Uri[];
}

/**
 * Sorts a write's notes, one at a time and in order, into those an Undo
 * puts back through the editor, those it writes to disk, and those it
 * leaves because they have changed since.
 */
async function planUndo(notes: readonly WrittenNote[]): Promise<UndoPlan> {
  const edit = new vscode.WorkspaceEdit();
  const documents: vscode.TextDocument[] = [];
  const quiet: UndoPlan['quiet'] = [];
  const skippedUris: vscode.Uri[] = [];

  for (const note of notes) {
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(note.uri);
    } catch {
      skippedUris.push(note.uri);
      continue;
    }
    // The note has to be what the write left, both on disk and in any
    // editor holding it. Either one differing means someone has been here
    // since, and an Undo is not Deckard's to make.
    const disk = await readFile(note.uri);
    if (document.getText() !== note.after || disk?.text !== note.after) {
      skippedUris.push(note.uri);
      continue;
    }
    // A note nobody has open is written straight to disk. Going through
    // the editor would open every note an undo touches, which is a lot of
    // tabs to close after taking one thing back.
    if (isOpenInEditor(note.uri) || document.isDirty) {
      edit.replace(note.uri, wholeDocument(document), note.before);
      documents.push(document);
    } else {
      quiet.push({ uri: note.uri, text: note.before, byteOrderMark: disk.byteOrderMark });
    }
  }
  return { edit, documents, quiet, skippedUris };
}

/**
 * Writes what a plan puts back: the editor edit, then a save of each note
 * it left unsaved, then the quiet notes to disk. False, with nothing
 * written, when VS Code refuses the editor edit.
 */
async function applyUndo(plan: UndoPlan): Promise<boolean> {
  if (plan.documents.length > 0 && !(await vscode.workspace.applyEdit(plan.edit))) {
    return false;
  }
  for (const document of plan.documents) {
    if (document.isDirty) {
      await document.save();
    }
  }
  for (const note of plan.quiet) {
    const text = Buffer.from(note.text, 'utf8');
    await vscode.workspace.fs.writeFile(
      note.uri,
      note.byteOrderMark ? Buffer.concat([BYTE_ORDER_MARK, text]) : text,
    );
  }
  return true;
}

/** How a write is shown before it lands. */
export type WritePreview = 'always' | 'severalNotes' | 'never';

/** Reads `deckard.previewWorkspaceWrites`; any value it does not know reads as severalNotes. */
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

/** What a write is called, how its preview reads, and what its Undo also puts back. */
export interface WorkspaceWriteOptions {
  /** What the write is, in the preview's heading and the Undo prompt. */
  label: string;
  /** What each changed note's row says in the preview. */
  description?: string;
  /** Whether to show the write first; the setting when not given. */
  preview?: WritePreview;
  /** Puts back what the write changed outside the notes, on an Undo. */
  restore?: () => Promise<void>;
  /**
   * Whether the notes go back together or not at all: true for a write
   * whose notes only make sense together, such as Move to…, which takes a
   * task out of one note and puts it into another. Its Undo puts nothing
   * back, and names the note, once any of them has changed since.
   */
  together?: boolean;
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
 * Says that a message's Undo took nothing back, because Deckard has written
 * since and the last write is no longer the one the message named.
 */
function reportWrittenSince(): void {
  void vscode.window.showInformationMessage(
    'Deckard has changed your notes again since, so use Deckard: Undo Last Change.',
  );
}

/**
 * Says what an Undo did: done, done but for notes changed since, or nothing,
 * because VS Code refused it or every note changed since.
 */
export function reportUndo(result: UndoResult | undefined, done: string): void {
  if (!result) {
    void vscode.window.showInformationMessage(
      'There is nothing to undo: Deckard has written something else since.',
    );
    return;
  }
  if (result.refused) {
    void reportFailure(describeRefusedUndo(result.refused, result.skipped));
    return;
  }
  if (result.restored === 0) {
    void reportStale(result.skippedUris);
    return;
  }
  if (result.skipped === 0) {
    void vscode.window.showInformationMessage(done);
    return;
  }
  void vscode.window.showWarningMessage(
    `${done} ${pluralize(result.skipped, 'note')} changed after Deckard last read ${
      result.skipped === 1 ? 'it and was' : 'them and were'
    } left as ${result.skipped === 1 ? 'it is' : 'they are'}.`,
  );
}

/**
 * VS Code refused an Undo's edit to the notes in `refused`, so none of the
 * write's `kept` notes was put back. Worded as a task edit's refused Undo
 * is, since the reader can do the same about it.
 */
function describeRefusedUndo(refused: readonly vscode.Uri[], kept: number): Failure {
  const where = refused.length === 1 ? noteName(refused[0]) : pluralize(refused.length, 'note');
  return {
    outcome: `VS Code did not accept the undo in ${where}, so ${
      kept === 1 ? 'the note keeps' : 'the notes keep'
    } the edit.`,
    fix: `Check that ${refused.length === 1 ? 'the note is' : 'the notes are'} not read-only, then try again.`,
  };
}

/** Whether a note is on screen, and so has to be written through its editor. */
function isOpenInEditor(uri: vscode.Uri): boolean {
  return vscode.window.visibleTextEditors.some(
    (editor) => editor.document.uri.toString() === uri.toString(),
  );
}

/** The three bytes of a UTF-8 byte order mark. */
const BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * A note as it stands on disk, or nothing when it cannot be read. Its text
 * leaves out a byte order mark, as VS Code's document does, so a note saved
 * with one does not read as changed since; whether it had one is kept, so
 * an Undo written to disk writes it back.
 */
async function readFile(
  uri: vscode.Uri,
): Promise<{ text: string; byteOrderMark: boolean } | undefined> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
  const byteOrderMark = bytes.subarray(0, 3).equals(BYTE_ORDER_MARK);
  return {
    text: (byteOrderMark ? bytes.subarray(3) : bytes).toString('utf8'),
    byteOrderMark,
  };
}

/** The range that replaces a note's whole text. */
function wholeDocument(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(
    new vscode.Position(0, 0),
    document.lineAt(Math.max(document.lineCount - 1, 0)).range.end,
  );
}

