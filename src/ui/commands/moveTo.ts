import * as vscode from 'vscode';
import { fileExists } from './fs';

import { MoveRefusalReason, readMoveBlock } from '../../domain/markdown/moveLines';
import { isHeading } from '../../domain/markdown/lineShapes';
import { listMentionedPlaces, MentionedPlace, readSectionBlock } from '../../domain/notes/moveSection';
import { getLinkableNoteFileName } from '../../domain/markdown/noteNames';
import { parseTaskDraft } from '../../domain/markdown/taskDraft';
import { STATUS_CHARACTER } from '../../domain/markdown/lineShapes';
import { readEntityNamespaceAliases, readTaskStatusOptions } from './parseSettings';
import { findDailyNoteDate, findFileDailyNoteDate, isDailyNoteFile, stripTags } from '../../domain/markdown/parser';
import { PreferenceServices } from '../../core/storage/preferences';
import { noteTitle } from '../../domain/index/backlinks';
import type { IndexReader } from '../../core/workspace/indexReader';
import { chooseTargetFolder, ensureDailyNote } from './dailyNote';
import { readWeekStart } from './datePrompt';
import { Destination, pickDestination } from './destinationPicker';
import { getSuggestedNoteName, validateExtractedNoteName } from './extractHeading';
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
 * into a new note, with a link left behind. On a heading line, or a
 * selection that starts on one, the heading and everything under it moves,
 * and can also go to the end of a note it mentions
 * (docs/implementation/47-move-section.md).
 *
 * What moves is read from the note as it is, and read again once the
 * destination is chosen; if it changed in between, nothing is written. The
 * move is one write that Undo takes back, in both notes.
 *
 * Deckard: Copy to… is the same command the other way: the lines are
 * written where the reader chooses, with a link to where they came from,
 * and stay where they were. Move to…'s list offers it as **Copy instead of
 * moving** (docs/implementation/49-meetings-and-types.md).
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
  heading: 'The selection holds a heading. To move a heading and everything under it, start the selection on the heading.',
  blank: 'Put the cursor on the line to move, or select the lines.',
  frontMatter: 'Front matter stays with its note. Select the lines below it.',
  splitFence: 'The selection ends inside a code block. Select the whole block to move it.',
};

/**
 * Move to… from the editor: the line, item, or selection under the cursor;
 * with `copy`, Copy to…, which starts the list the other way.
 */
export async function moveToCommand(
  indexer: IndexReader<vscode.Uri>,
  preferences: MovePreferences,
  writes: TaskWrites,
  { copy = false }: { copy?: boolean } = {},
): Promise<void> {
  await indexer.ready;
  const editor = vscode.window.activeTextEditor;
  if (!editor || !indexer.isNotesFile(editor.document.uri)) {
    void vscode.window.showInformationMessage(`Open a note in your notes folder to ${copy ? 'copy' : 'move'} lines from it.`);
    return;
  }
  const { uri } = editor.document;
  const filePath = indexer.getFilePath(uri);
  const lines = editor.document.getText().split(/\r?\n/);
  const section = readSectionBlock(lines, editor.selection);
  if (section) {
    const mentioned = listMentionedPlaces(indexer.getSnapshot(), section.lines, {
      sourcePath: filePath,
      aliases: readEntityNamespaceAliases(uri),
    });
    // A section that leaves a daily note takes the note's day into its heading.
    const day = findFileDailyNoteDate(indexer.parse(uri, editor.document.getText()));
    await moveBlocks(indexer, preferences, writes, { sources: [{ uri, filePath, block: section, day }], mentioned, copy });
    return;
  }
  const read = readMoveBlock(lines, editor.selection, readTaskStatusOptions(uri));
  if ('refused' in read) {
    void vscode.window.showInformationMessage(REFUSALS[read.refused]);
    return;
  }
  await moveBlocks(indexer, preferences, writes, { sources: [{ uri, filePath, block: read }], copy });
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
    await moveBlocks(indexer, preferences, writes, { sources: read.sources });
  }
}

/** Where a move writes, once chosen and found again, and the heading it names. */
interface ResolvedTarget extends MoveTarget<vscode.Uri> {
  /** The heading to remember as recent. */
  recent?: PinnedNote;
}

/** What is moved, the places it mentions, and whether it is copied rather than moved. */
interface MoveRequest {
  sources: readonly MoveSource[];
  mentioned?: readonly MentionedPlace[];
  copy?: boolean;
}

/**
 * Moves the blocks where the reader chooses, or copies them there: the
 * destination is picked and found again here, the move is MoveService's,
 * and what moved is said here. A section moved is offered the places it
 * mentions first.
 */
async function moveBlocks(
  indexer: IndexReader<vscode.Uri>,
  preferences: MovePreferences,
  writes: TaskWrites,
  { sources, mentioned = [], copy = false }: MoveRequest,
): Promise<void> {
  const destination = await pickMoveDestination(indexer, preferences.reader, { sources, mentioned, copy });
  if (!destination) {
    return;
  }
  if (destination.kind === 'otherWay') {
    // Asked again the other way: the list is the same, and says which it is.
    await moveBlocks(indexer, preferences, writes, { sources, mentioned, copy: !copy });
    return;
  }
  const target = await resolveTarget(indexer, destination, sources);
  if (!target) {
    return;
  }
  const result = await writes.moves.move(sources, target, { copy });
  if (result.kind === 'stale') {
    void reportStaleMove(copy);
    return;
  }
  if (result.kind === 'failed') {
    void reportFailure({ outcome: `Deckard could not ${copy ? 'copy' : 'move'} it, so nothing was written.` });
    return;
  }
  if (target.recent) {
    await preferences.usage.recordRecentHeading(target.recent);
  }
  announceMove(sources, target, { created: result.created, copy }, result.handle);
}

/** The words Move to…'s list is asked in, moving or copying, for lines or for a section. */
export function describeMovePicker(copy: boolean, section: boolean): Pick<
  Parameters<typeof pickDestination>[2],
  'title' | 'placeholder' | 'otherWay'
> {
  const what = section ? 'the section' : 'it';
  const places = section ? 'under a heading, at the end of a note, or a new note' : 'a heading, today’s note, or a new note';
  return copy
    ? {
        title: 'Deckard: Copy to…',
        placeholder: `Choose where the copy of ${what} goes: ${places}`,
        otherWay: { label: '$(arrow-right) Move instead of copying', description: 'leaves a link where it was' },
      }
    : {
        title: 'Deckard: Move to…',
        placeholder: `Choose where ${what} goes: ${places}`,
        otherWay: { label: '$(copy) Copy instead of moving', description: 'leaves it where it is' },
      };
}

/**
 * Asks where the blocks go: a heading, today's note, or a new note, or for
 * a section, first the places it mentions; never a heading inside what
 * moves or one whose lines hold it. The list also offers to go the other
 * way, copying what it would move or moving what it would copy.
 */
function pickMoveDestination(
  indexer: IndexReader<vscode.Uri>,
  preferences: Pick<PreferencesReader, 'value'>,
  { sources, mentioned = [], copy = false }: MoveRequest,
): Promise<Destination | undefined> {
  const index = indexer.getSnapshot();
  const todayName = getPeriodicNote('day', new Date(), readWeekStart()).name;
  const sourceFiles = new Set(sources.map((source) => source.filePath));
  return pickDestination(index, preferences, {
    ...describeMovePicker(copy, isSectionMove(sources)),
    today: { fileName: `${todayName}.md` },
    newNote: true,
    mentioned,
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

/** Whether what moves is a heading and everything under it. */
function isSectionMove(sources: readonly MoveSource[]): boolean {
  return sources.some((source) => source.block.section !== undefined);
}

/** Finds the chosen destination again, as a place a move can write. */
async function resolveTarget(
  indexer: IndexReader<vscode.Uri>,
  destination: Destination,
  sources: readonly MoveSource[],
): Promise<ResolvedTarget | undefined> {
  switch (destination.kind) {
    case 'today':
      return resolveToday();
    case 'newNote':
      return resolveNewNote(indexer, sources);
    case 'note':
      return resolveNote(indexer, destination.filePath);
    case 'heading':
      return resolveSection(indexer, destination, isSectionMove(sources));
    case 'otherWay':
      // Not a place: moveBlocks asks again before it gets here.
      return undefined;
  }
}

/** A note a section mentions, at its end. */
async function resolveNote(indexer: IndexReader<vscode.Uri>, filePath: string): Promise<ResolvedTarget | undefined> {
  const uri = await resolveSourceUri(filePath);
  if (!uri || !(await fileExists(uri))) {
    void reportFailure({ outcome: `Deckard could not find ${filePath}, so nothing was moved.` });
    return undefined;
  }
  const title = noteTitle(filePath);
  const file = indexer.getSnapshot().files.get(filePath);
  return { uri, link: title, name: title, daily: file !== undefined && isDailyNoteFile(file) };
}

/** Today's note, made if it is missing, in the folder the reader picks. */
async function resolveToday(): Promise<ResolvedTarget | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  const uri = await ensureDailyNote(folder);
  const title = noteTitle(uri.path);
  return { uri, link: title, name: title, daily: true };
}

/**
 * A new note, named by the reader, which must not exist yet. A section's
 * note is named as Extract Heading names it, from its heading, and holds
 * the section as it was written, its heading the note's first line.
 */
async function resolveNewNote(
  indexer: IndexReader<vscode.Uri>,
  sources: readonly MoveSource[],
): Promise<ResolvedTarget | undefined> {
  const first = sources[0].block.lines[0] ?? '';
  const section = sources[0].block.section;
  const name = await vscode.window.showInputBox({
    title: 'Deckard: Move to…',
    prompt: 'Name the new note',
    value: section ? getSuggestedNoteName(section.heading) : suggestNoteName(first),
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
  return {
    uri,
    link: title,
    name: title,
    create: section ? '' : `# ${name.trim()}\n\n`,
    // Named for a day, the new note is a daily note.
    daily: findDailyNoteDate(indexer.getFilePath(uri), []) !== undefined,
  };
}

/**
 * A heading the index knows, found again in its note as the note is now:
 * its own lines, where lines go, or for a section, `whole`, its lines with
 * everything nested under it, and its level.
 */
async function resolveSection(
  indexer: IndexReader<vscode.Uri>,
  destination: Extract<Destination, { kind: 'heading' }>,
  whole: boolean,
): Promise<ResolvedTarget | undefined> {
  const uri = await resolveSourceUri(destination.filePath);
  if (!uri) {
    void reportFailure({ outcome: `Deckard could not find ${destination.filePath}, so nothing was moved.` });
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const live = indexer.parse(uri, document.getText());
  const found = readSectionTarget(indexer.getSnapshot(), destination.filePath, destination.section, live.sections);
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
    section: whole
      ? { startLine: found.section.startLine, endLine: found.section.endLine, headingLevel: found.section.headingLevel }
      : { startLine: found.section.startLine, endLine: found.section.bodyEndLine },
    recent: found.recent,
    daily: isDailyNoteFile(live),
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

/** Says nothing was moved, or copied, because the lines changed while the destination was being chosen. */
function reportStaleMove(copy = false): Thenable<unknown> {
  return reportFailure({
    outcome: `Deckard did not ${copy ? 'copy' : 'move'} it: the lines changed while you were choosing where.`,
  });
}

/** Says what moved, or was copied, and where, with Open and Undo. */
function announceMove(
  sources: readonly MoveSource[],
  target: ResolvedTarget,
  { created, copy }: { created: boolean; copy: boolean },
  handle: WriteHandle,
): void {
  const what = describeMoved(sources, created);
  const where = created ? `a new note, ${target.name}` : target.name;
  handle.offerUndo(
    `${copy ? 'Copied' : 'Moved'} ${what} to ${where}.`,
    { guard: 'latest', done: copy ? 'Took the copy out.' : 'Put it back.' },
    {
      label: 'Open',
      run: async () => {
        await vscode.window.showTextDocument(target.uri, { preview: false });
      },
    },
  );
}

/**
 * What moved, as the announcement names it: a section by its heading, one
 * task by its title, several by their count, and anything else, or anything
 * moved into a new note, by its lines.
 */
function describeMoved(sources: readonly MoveSource[], created: boolean): string {
  const section = sources[0]?.block.section;
  if (section) {
    const words = (stripTags(section.heading) || section.heading).replace(/\s+/g, ' ').trim();
    return `"${words.length > 60 ? `${words.slice(0, 57)}…` : words}"`;
  }
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
 * the notes folder, and Move section to… on a heading line or a selection
 * that starts on one. Not on every line of prose, which would put a
 * lightbulb on almost every line.
 */
export class MoveToActions implements vscode.CodeActionProvider {
  /** Offers the action only in notes `indexer` counts as being in the notes folder. */
  public constructor(private readonly indexer: Pick<IndexReader, 'isNotesFile'>) {}

  /**
   * Move section to… on a heading, Move to… on a task line or on any other
   * selection, in a note; nothing on an empty cursor on a line that is
   * neither, or outside the notes folder. Both run Move to…, which reads
   * the cursor the same way.
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!this.indexer.isNotesFile(document.uri)) {
      return [];
    }
    const line = document.lineAt(range.start.line).text;
    // A heading only in looks, in code or front matter, is read as a line.
    const onHeading =
      isHeading(line) &&
      readSectionBlock(document.getText().split(/\r?\n/), {
        start: range.start,
        end: range.end,
        isEmpty: range.isEmpty,
      }) !== undefined;
    if (range.isEmpty && !onHeading && !TASK_START.test(line)) {
      return [];
    }
    const title = onHeading ? 'Move section to…' : 'Move to…';
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorMove);
    action.command = { command: 'deckard.moveTo', title };
    return [action];
  }
}
