import * as vscode from 'vscode';
import { fileExists } from './fs';

import { MoveRefusalReason, readMoveBlock } from '../../domain/markdown/moveLines';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';
import { parseTaskDraft } from '../../domain/markdown/taskDraft';
import { stripTags } from '../../domain/markdown/parser';
import { PreferencesStore } from '../../core/storage/preferences';
import { Task } from '../../core/types';
import { noteTitle } from '../../domain/index/backlinks';
import type { IndexReader } from '../../core/workspace/indexReader';
import { createPinForLine } from '../state/pinnedNotes';
import { findSameSection } from './capture';
import { chooseTargetFolder, ensureDailyNote, getPeriodicNote } from './dailyNote';
import { readWeekStart } from './datePrompt';
import { Destination, pickDestination } from './destinationPicker';
import { validateExtractedNoteName } from './extractHeading';
import { MoveSource as ServiceMoveSource, MoveTarget } from '../../services/moveService';
import { TaskWrites } from './taskActions';
import { createWikiLink } from './insertLink';
import { resolveSourceUri } from './navigation';
import { reportFailure } from './notify';
import { WriteHandle } from './workspaceWrites';

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
  preferences: PreferencesStore,
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
  preferences: PreferencesStore,
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
  heading?: { filePath: string; line: number };
}

/**
 * Moves the blocks where the reader chooses: the destination is picked and
 * found again here, the move is MoveService's, and what moved is said here.
 */
async function moveBlocks(
  indexer: IndexReader<vscode.Uri>,
  preferences: PreferencesStore,
  writes: TaskWrites,
  sources: readonly MoveSource[],
): Promise<void> {
  const destination = await pickMoveDestination(indexer, preferences, sources);
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
  if (target.heading) {
    const pin = createPinForLine(indexer.getSnapshot(), target.heading.filePath, target.heading.line);
    if (pin?.heading) {
      await preferences.recordRecentHeading(pin);
    }
  }
  announceMove(sources, target, result.created, result.handle);
}

/**
 * Asks where the blocks go: a heading, today's note, or a new note, never a
 * heading inside what moves or the one whose own lines hold it.
 */
function pickMoveDestination(
  indexer: IndexReader<vscode.Uri>,
  preferences: PreferencesStore,
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
  const eol = '\n';
  return { uri, link: title, name: title, create: `# ${name.trim()}${eol}${eol}` };
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
  const saved = indexer.getSnapshot().files.get(destination.filePath)?.sections ?? [];
  const live = findSameSection(saved, destination.section, indexer.parse(uri, document.getText()).sections);
  const heading = stripTags(destination.section.heading).trim() || destination.section.heading;
  if (!live) {
    void reportFailure({
      outcome: `Deckard did not move it: the heading “${heading}” is no longer in ${destination.filePath.split('/').pop()}.`,
    });
    return undefined;
  }
  const link = createWikiLink(indexer.getSnapshot(), destination.filePath, destination.section.id).text.slice(2, -2);
  return {
    uri,
    link,
    name: `${noteTitle(destination.filePath)} › ${heading}`,
    section: { startLine: live.startLine, endLine: live.bodyEndLine },
    heading: { filePath: destination.filePath, line: destination.section.startLine },
  };
}

/** The first eight words of a line, without its marker, tags, or metadata. */
export function suggestNoteName(line: string): string {
  const draft = parseTaskDraft(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?!\[)/, ''));
  const words = stripTags(draft.description)
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/[/\\<>:"|?*#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return words.join(' ');
}

async function newNoteUri(
  indexer: IndexReader<vscode.Uri>,
  from: vscode.Uri,
  name: string,
): Promise<vscode.Uri | undefined> {
  const fileName = getExtractedNoteFileName(name);
  const folder = vscode.workspace.getWorkspaceFolder(from) ?? vscode.workspace.workspaceFolders?.[0];
  return fileName && folder ? vscode.Uri.joinPath(indexer.getNotesFolderUri(folder), fileName) : undefined;
}

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
  const tasks = sources.flatMap((source) => source.block.openTasks ?? []);
  const lineCount = sources.reduce((total, source) => total + source.block.lines.length, 0);
  const allTasks = sources.every((source) => source.block.openTasks !== undefined);
  const what = created
    ? `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`
    : allTasks && tasks.length === 1
      ? `"${describeTask(sources[0].block.lines[0])}"`
      : allTasks
        ? `${tasks.length} tasks`
        : `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
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

function describeTask(line: string): string {
  const title = stripTags(parseTaskDraft(line).description).replace(/\s+/g, ' ').trim();
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

/**
 * The lightbulb's Move to…: on a task line, or on a selection, in a note in
 * the notes folder. Not on every line of prose, which would put a lightbulb
 * on almost every line.
 */
export class MoveToActions implements vscode.CodeActionProvider {
  public constructor(private readonly indexer: Pick<IndexReader, 'isNotesFile'>) {}

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!this.indexer.isNotesFile(document.uri)) {
      return [];
    }
    const line = document.lineAt(range.start.line).text;
    if (range.isEmpty && !/^\s*[-*+][ \t]+\[[ xX]\]/.test(line)) {
      return [];
    }
    const action = new vscode.CodeAction('Move to…', vscode.CodeActionKind.RefactorMove);
    action.command = { command: 'deckard.moveTo', title: 'Move to…' };
    return [action];
  }
}
