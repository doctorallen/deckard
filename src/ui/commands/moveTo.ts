import * as vscode from 'vscode';
import { fileExists } from './fs';

import { MoveRefusalReason, readMoveBlock } from '../../domain/markdown/moveLines';
import { getLinkableNoteFileName } from '../../domain/markdown/noteNames';
import { parseTaskDraft } from '../../domain/markdown/taskDraft';
import { STATUS_CHARACTER } from '../../domain/markdown/lineShapes';
import { stripTags } from '../../domain/markdown/parser';
import { PreferenceServices } from '../../core/storage/preferences';
import { noteTitle } from '../../domain/index/backlinks';
import type { IndexReader } from '../../core/workspace/indexReader';
import { chooseTargetFolder, ensureDailyNote } from './dailyNote';
import { readWeekStart } from './datePrompt';
import { Destination, pickDestination } from './destinationPicker';
import { validateExtractedNoteName } from './extractHeading';
import { MoveSource as ServiceMoveSource, MoveTarget } from '../../services/moveService';
import { TaskWrites } from './taskActions';
import { createWikiLinkToSection } from './insertLink';
import { resolveSourceUri } from './navigation';
import { reportFailure } from './notify';
import { WriteHandle } from './workspaceWrites';
import { getPeriodicNote } from '../../domain/notes/periodicNotes';
import { findSameSection } from '../../domain/capture/captureLines';
import { createPinForSection } from '../../domain/notes/pins';
import { PinnedNote, Section, Task, WorkspaceIndex } from '../../domain/model';
import { PreferencesReader } from '../../core/storage/preferencesRepository';

/**
 * Deckard: Move to… — a line, a task and its steps, or a selection, taken
 * from where it is and put under another heading, into today's note, or
 * into a new note, with a link left behind.
 *
 * What moves is read from the note as it is, and read again once the
 * destination is chosen; if it changed in between, nothing is written. The
 * move is one write that Undo takes back, in both notes.
 */

/** One block to move, from one note. */
export type MoveSource = ServiceMoveSource<vscode.Uri>;

/**
 * What Move to… takes of the preferences: the recent headings and view
 * counts it ranks destinations by, and the usage it records a heading in.
 */
export type MovePreferences = Pick<PreferenceServices, 'reader' | 'usage'>;

/** The words each refusal says. */
const REFUSALS: Readonly<Record<MoveRefusalReason, string>> = {
  heading: 'Move to… moves lines and tasks. To move a heading and everything under it, use Extract Heading.',
  blank: 'Put the cursor on the line to move, or select the lines.',
  frontMatter: 'Front matter stays with its note. Select the lines below it.',
  splitFence: 'The selection ends inside a code block. Select the whole block to move it.',
};

/** Move to… from the editor: the line, item, or selection under the cursor. */
export async function moveToCommand(
  indexer: IndexReader<vscode.Uri>,
  preferences: MovePreferences,
  writes: TaskWrites,
): Promise<void> {
  await indexer.ready;
  const editor = vscode.window.activeTextEditor;
  if (!editor || !indexer.isNotesFile(editor.document.uri)) {
    void vscode.window.showInformationMessage('Open a note in your notes folder to move lines from it.');
    return;
  }
  const lines = editor.document.getText().split(/\r?\n/);
  const read = readMoveBlock(lines, editor.selection);
  if ('refused' in read) {
    if (read.refused === 'heading') {
      void vscode.window
        .showInformationMessage(REFUSALS.heading, 'Extract Heading')
        .then((choice) => {
          if (choice === 'Extract Heading') {
            void vscode.commands.executeCommand('deckard.extractHeading');
          }
        });
    } else {
      void vscode.window.showInformationMessage(REFUSALS[read.refused]);
    }
    return;
  }
  await moveBlocks(indexer, preferences, writes, [
    { uri: editor.document.uri, filePath: indexer.getFilePath(editor.document.uri), block: read },
  ]);
}

/**
 * Moves tasks the index knows, each with its steps, from wherever they are
 * written; they land together, in the order given.
 */
export async function moveTasks(
  indexer: IndexReader<vscode.Uri>,
  preferences: MovePreferences,
  writes: TaskWrites,
  tasks: readonly Task[],
): Promise<void> {
  const read = await writes.moves.readTasks(tasks);
  if (read.kind === 'stale') {
    void reportStaleMove();
    return;
  }
  if (read.sources.length > 0) {
    await moveBlocks(indexer, preferences, writes, read.sources);
  }
}

/** Where a move writes, once chosen and found again, and the heading it names. */
interface ResolvedTarget extends MoveTarget<vscode.Uri> {
  /** The heading to remember as recent. */
  recent?: PinnedNote;
}

/**
 * Moves the blocks where the reader chooses: the destination is picked and
 * found again here, the move is MoveService's, and what moved is said here.
 */
async function moveBlocks(
  indexer: IndexReader<vscode.Uri>,
  preferences: MovePreferences,
  writes: TaskWrites,
  sources: readonly MoveSource[],
): Promise<void> {
  const destination = await pickMoveDestination(indexer, preferences.reader, sources);
  if (!destination) {
    return;
  }
  const target = await resolveTarget(indexer, destination, sources);
  if (!target) {
    return;
  }
  const result = await writes.moves.move(sources, target);
  if (result.kind === 'stale') {
    void reportStaleMove();
    return;
  }
  if (result.kind === 'failed') {
    void reportFailure({ outcome: 'Deckard could not move it, so nothing was written.' });
    return;
  }
  if (target.recent) {
    await preferences.usage.recordRecentHeading(target.recent);
  }
  announceMove(sources, target, result.created, result.handle);
}

/**
 * Asks where the blocks go: a heading, today's note, or a new note, never a
 * heading inside what moves or the one whose own lines hold it.
 */
function pickMoveDestination(
  indexer: IndexReader<vscode.Uri>,
  preferences: Pick<PreferencesReader, 'value'>,
  sources: readonly MoveSource[],
): Promise<Destination | undefined> {
  const index = indexer.getSnapshot();
  const todayName = getPeriodicNote('day', new Date(), readWeekStart()).name;
  const sourceFiles = new Set(sources.map((source) => source.filePath));
  return pickDestination(index, preferences, {
    title: 'Deckard: Move to…',
    placeholder: 'Choose where it goes: a heading, today’s note, or a new note',
    today: { fileName: `${todayName}.md` },
    newNote: true,
    exclude: (section) =>
      sourceFiles.has(section.filePath) &&
      sources.some(
        (source) =>
          source.filePath === section.filePath &&
          // A heading inside the block, or the one whose own lines hold it.
          ((section.startLine - 1 >= source.block.start && section.startLine - 1 <= source.block.end) ||
            (section.startLine - 1 < source.block.start && section.bodyEndLine - 1 >= source.block.end)),
      ),
  });
}

/** Finds the chosen destination again, as a place a move can write. */
async function resolveTarget(
  indexer: IndexReader<vscode.Uri>,
  destination: Destination,
  sources: readonly MoveSource[],
): Promise<ResolvedTarget | undefined> {
  if (destination.kind === 'today') {
    return resolveToday();
  }
  if (destination.kind === 'newNote') {
    return resolveNewNote(indexer, sources);
  }
  return resolveSection(indexer, destination);
}

/** Today's note, made if it is missing, in the folder the reader picks. */
async function resolveToday(): Promise<ResolvedTarget | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  const uri = await ensureDailyNote(folder);
  const title = noteTitle(uri.path);
  return { uri, link: title, name: title };
}

/** A new note, named by the reader, which must not exist yet. */
async function resolveNewNote(
  indexer: IndexReader<vscode.Uri>,
  sources: readonly MoveSource[],
): Promise<ResolvedTarget | undefined> {
  const first = sources[0].block.lines[0] ?? '';
  const name = await vscode.window.showInputBox({
    title: 'Deckard: Move to…',
    prompt: 'Name the new note',
    value: suggestNoteName(first),
    validateInput: async (value) => {
      const invalid = validateExtractedNoteName(value);
      if (invalid) {
        return invalid;
      }
      const uri = await newNoteUri(indexer, sources[0].uri, value);
      return uri && (await fileExists(uri)) ? `A note called “${value.trim()}” already exists.` : undefined;
    },
  });
  if (name === undefined) {
    return undefined;
  }
  const uri = await newNoteUri(indexer, sources[0].uri, name);
  if (!uri || (await fileExists(uri))) {
    return undefined;
  }
  const title = noteTitle(uri.path);
  // The move writes the new note in its source's line ending.
  return { uri, link: title, name: title, create: `# ${name.trim()}\n\n` };
}

/** A heading the index knows, found again in its note as the note is now. */
async function resolveSection(
  indexer: IndexReader<vscode.Uri>,
  destination: Extract<Destination, { kind: 'heading' }>,
): Promise<ResolvedTarget | undefined> {
  const uri = await resolveSourceUri(destination.filePath);
  if (!uri) {
    void reportFailure({ outcome: `Deckard could not find ${destination.filePath}, so nothing was moved.` });
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const found = readSectionTarget(
    indexer.getSnapshot(),
    destination.filePath,
    destination.section,
    indexer.parse(uri, document.getText()).sections,
  );
  const heading = stripTags(destination.section.heading).trim() || destination.section.heading;
  if (!found) {
    void reportFailure({
      outcome: `Deckard did not move it: the heading “${heading}” is no longer in ${destination.filePath.split('/').pop()}.`,
    });
    return undefined;
  }
  return {
    uri,
    link: found.link,
    name: `${noteTitle(destination.filePath)} › ${heading}`,
    section: { startLine: found.section.startLine, endLine: found.section.bodyEndLine },
    recent: found.recent,
  };
}

/** A heading a move writes under, as its note holds it now, and the link to it. */
export interface SectionTarget {
  /** The heading, found again among the note's sections as it is now. */
  section: Section;
  /** What a link left behind names, `Note#Heading`, without its brackets. */
  link: string;
  /** The heading to remember as recent, for the next Move to… or capture. */
  recent: PinnedNote;
}

/**
 * Finds `chosen`, a heading chosen from `index`, again among `live`, the
 * sections of `filePath` as the note is now, with the link a move leaves
 * behind to it and the heading to remember as recent. Undefined when the
 * note no longer holds the heading.
 */
export function readSectionTarget(
  index: WorkspaceIndex,
  filePath: string,
  chosen: Section,
  live: readonly Section[],
): SectionTarget | undefined {
  const saved = index.files.get(filePath)?.sections ?? [];
  const section = findSameSection(saved, chosen, live);
  if (!section) {
    return undefined;
  }
  // From the heading as the note holds it: the index may have read the note
  // again since the heading was chosen, and no longer know it by its id or
  // hold it at the line it was chosen at.
  const link = createWikiLinkToSection(index, filePath, section).text.slice(2, -2);
  return { section, link, recent: createPinForSection(filePath, live, section) };
}

/**
 * The first eight words of a line, without its marker, tags, or metadata,
 * nor any character a file name or the link left behind cannot hold, nor
 * the dots a sentence ends in, since a file name cannot end in one.
 */
export function suggestNoteName(line: string): string {
  const draft = parseTaskDraft(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?!\[)/, ''));
  const words = stripTags(draft.description)
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/[/\\<>:"|?*#^[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return words.join(' ').replace(/[. ]+$/, '');
}

/**
 * Where a new note named `name` goes: the notes folder of the workspace
 * folder `from` is in, or else of the first one. Undefined when the name
 * cannot be a file name the link left behind opens, or no folder is open.
 */
async function newNoteUri(
  indexer: IndexReader<vscode.Uri>,
  from: vscode.Uri,
  name: string,
): Promise<vscode.Uri | undefined> {
  const fileName = getLinkableNoteFileName(name);
  const folder = vscode.workspace.getWorkspaceFolder(from) ?? vscode.workspace.workspaceFolders?.[0];
  return fileName && folder ? vscode.Uri.joinPath(indexer.getNotesFolderUri(folder), fileName) : undefined;
}

/** Says nothing was moved because the lines changed while the destination was being chosen. */
function reportStaleMove(): Thenable<unknown> {
  return reportFailure({
    outcome: 'Deckard did not move it: the lines changed while you were choosing where.',
  });
}

/** Says what moved and where, with Open and Undo. */
function announceMove(
  sources: readonly MoveSource[],
  target: ResolvedTarget,
  created: boolean,
  handle: WriteHandle,
): void {
  const what = describeMoved(sources, created);
  const where = created ? `a new note, ${target.name}` : target.name;
  handle.offerUndo(
    `Moved ${what} to ${where}.`,
    { guard: 'latest', done: 'Put it back.' },
    {
      label: 'Open',
      run: async () => {
        await vscode.window.showTextDocument(target.uri, { preview: false });
      },
    },
  );
}

/**
 * What moved, as the announcement names it: one task by its title, several
 * by their count, and anything else, or anything moved into a new note, by
 * its lines.
 */
function describeMoved(sources: readonly MoveSource[], created: boolean): string {
  const tasks = sources.flatMap((source) => source.block.openTasks ?? []);
  const lineCount = sources.reduce((total, source) => total + source.block.lines.length, 0);
  const allTasks = sources.every((source) => source.block.openTasks !== undefined);
  if (created || !allTasks) {
    return `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
  }
  if (tasks.length === 1) {
    return `"${describeTask(sources[0].block.lines[0])}"`;
  }
  return `${tasks.length} tasks`;
}

/** A task's title without its tags, cut to 60 characters, as an announcement quotes it. */
function describeTask(line: string): string {
  const title = stripTags(parseTaskDraft(line).description).replace(/\s+/g, ' ').trim();
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

/** The start of a task line of any status, on which Move to… is offered with nothing selected. */
const TASK_START = new RegExp(String.raw`^\s*[-*+][ \t]+\[${STATUS_CHARACTER}\]`);

/**
 * The lightbulb's Move to…: on a task line, or on a selection, in a note in
 * the notes folder. Not on every line of prose, which would put a lightbulb
 * on almost every line.
 */
export class MoveToActions implements vscode.CodeActionProvider {
  /** Offers the action only in notes `indexer` counts as being in the notes folder. */
  public constructor(private readonly indexer: Pick<IndexReader, 'isNotesFile'>) {}

  /**
   * Move to… on a task line, or on any selection, in a note; nothing on an
   * empty cursor on a line that is not a task, or outside the notes folder.
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!this.indexer.isNotesFile(document.uri)) {
      return [];
    }
    const line = document.lineAt(range.start.line).text;
    if (range.isEmpty && !TASK_START.test(line)) {
      return [];
    }
    const action = new vscode.CodeAction('Move to…', vscode.CodeActionKind.RefactorMove);
    action.command = { command: 'deckard.moveTo', title: 'Move to…' };
    return [action];
  }
}
