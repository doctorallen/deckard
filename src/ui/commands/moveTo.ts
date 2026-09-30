import * as vscode from 'vscode';
import { fileExists } from './fs';

import {
  applySplices,
  blockSplice,
  dedentBlock,
  LeaveBehind,
  leaveBehind,
  MoveBlock,
  MoveRefusalReason,
  readMoveBlock,
  TextSplice,
} from '../../domain/markdown/moveLines';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';
import { parseTaskDraft } from '../../domain/markdown/taskDraft';
import { stripTags } from '../../domain/markdown/parser';
import { PreferencesStore } from '../../core/storage/preferences';
import { Section, Task } from '../../core/types';
import { noteTitle } from '../../domain/index/backlinks';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { createPinForLine } from '../state/pinnedNotes';
import { findSameSection, getCaptureInsertion } from './capture';
import { chooseTargetFolder, ensureDailyNote, getPeriodicNote } from './dailyNote';
import { readWeekStart } from './datePrompt';
import { Destination, pickDestination } from './destinationPicker';
import { validateExtractedNoteName } from './extractHeading';
import { TaskWrites } from './taskActions';
import { rankMoveTo } from '../../domain/tasks/taskRank';
import { createWikiLink } from './insertLink';
import { resolveSourceUri } from './navigation';
import { reportFailure } from './notify';
import { getWritePreview, WriteHandle } from './workspaceWrites';

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
export interface MoveSource {
  uri: vscode.Uri;
  filePath: string;
  block: MoveBlock;
  /** From the index: the line must still be the task it knows. */
  task?: Task;
}

/** The words each refusal says. */
const REFUSALS: Readonly<Record<MoveRefusalReason, string>> = {
  heading: 'Move to… moves lines and tasks. To move a heading and everything under it, use Extract Heading.',
  blank: 'Put the cursor on the line to move, or select the lines.',
  frontMatter: 'Front matter stays with its note. Select the lines below it.',
  splitFence: 'The selection ends inside a code block. Select the whole block to move it.',
};

/** Move to… from the editor: the line, item, or selection under the cursor. */
export async function moveToCommand(
  indexer: WorkspaceIndexer<vscode.Uri>,
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
  indexer: WorkspaceIndexer<vscode.Uri>,
  preferences: PreferencesStore,
  writes: TaskWrites,
  tasks: readonly Task[],
): Promise<void> {
  const sources: MoveSource[] = [];
  for (const task of tasks) {
    const uri = await resolveSourceUri(task.filePath);
    if (!uri) {
      continue;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const line = task.lineNumber - 1;
    const read = readMoveBlock(document.getText().split(/\r?\n/), {
      start: { line, character: 0 },
      end: { line, character: 0 },
      isEmpty: true,
    });
    if ('refused' in read || read.lines[0] !== task.sourceLineText) {
      void reportStaleMove();
      return;
    }
    sources.push({ uri, filePath: task.filePath, block: read, task });
  }
  if (sources.length > 0) {
    await moveBlocks(indexer, preferences, writes, sources);
  }
}

/** Where a move writes, once chosen and found again. */
interface ResolvedTarget {
  uri: vscode.Uri;
  /** What the link left behind names, without its brackets. */
  link: string;
  /** How a message names the place. */
  name: string;
  /** Under a heading: its own lines. Absent: the end of the note. */
  section?: Pick<Section, 'startLine' | 'endLine'>;
  /** A note to create, with what it starts with before the moved lines. */
  create?: string;
  /** The heading to remember as recent. */
  heading?: { filePath: string; line: number };
}

async function moveBlocks(
  indexer: WorkspaceIndexer<vscode.Uri>,
  preferences: PreferencesStore,
  writes: TaskWrites,
  sources: readonly MoveSource[],
): Promise<void> {
  const index = indexer.getSnapshot();
  const todayName = getPeriodicNote('day', new Date(), readWeekStart()).name;
  const sourceFiles = new Set(sources.map((source) => source.filePath));
  const destination = await pickDestination(index, preferences, {
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
  if (!destination) {
    return;
  }
  const target = await resolveTarget(indexer, destination, sources);
  if (!target) {
    return;
  }

  // Read again: what moves must still be what was chosen.
  const texts = new Map<string, string>();
  for (const source of sources) {
    const document = await vscode.workspace.openTextDocument(source.uri);
    const text = document.getText();
    texts.set(source.uri.toString(), text);
    const now = text.split(/\r?\n/).slice(source.block.start, source.block.end + 1);
    if (
      now.join('\n') !== source.block.lines.join('\n') ||
      (source.task && now[0] !== source.task.sourceLineText)
    ) {
      void reportStaleMove();
      return;
    }
  }

  const mode = readLeaveBehind();
  const targetDocument = target.create ? undefined : await vscode.workspace.openTextDocument(target.uri);
  const targetText = targetDocument?.getText() ?? '';
  const eol = (targetDocument ? targetText : texts.get(sources[0].uri.toString()) ?? '').includes('\r\n') ? '\r\n' : '\n';
  const moved = sources.flatMap((source) => dedentBlock(source.block.lines)).join(eol);

  const edit = new vscode.WorkspaceEdit();
  const splicesBy = new Map<string, { uri: vscode.Uri; text: string; splices: TextSplice[] }>();
  for (const source of sources) {
    const key = source.uri.toString();
    const text = texts.get(key) ?? '';
    const lines = text.split(/\r?\n/);
    const entry = splicesBy.get(key) ?? { uri: source.uri, text, splices: [] };
    entry.splices.push(blockSplice(text, source.block, leaveBehind(source.block, lines, target.link, mode)));
    splicesBy.set(key, entry);
  }
  let insertedAt: number | undefined;
  if (!target.create) {
    const insertion = getCaptureInsertion(targetText, moved, target.section);
    insertedAt = insertion.taskLine;
    const offset = (targetDocument as vscode.TextDocument).offsetAt(
      new vscode.Position(insertion.line, insertion.character),
    );
    const key = target.uri.toString();
    const entry = splicesBy.get(key) ?? { uri: target.uri, text: targetText, splices: [] };
    entry.splices.push({ start: offset, end: offset, text: insertion.text });
    splicesBy.set(key, entry);
  }
  for (const entry of splicesBy.values()) {
    // A note is written as one whole replace, so a take and a put in the
    // same note can never overlap.
    const document = await vscode.workspace.openTextDocument(entry.uri);
    edit.replace(
      entry.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(entry.text.length)),
      applySplices(entry.text, entry.splices),
    );
  }

  let created: { uri: vscode.Uri; text: string } | undefined;
  if (target.create !== undefined) {
    const text = `${target.create}${moved}${eol}`;
    await vscode.workspace.fs.writeFile(target.uri, Buffer.from(text, 'utf8'));
    created = { uri: target.uri, text };
  }
  const deleteCreated = async (): Promise<void> => {
    if (!created) {
      return;
    }
    try {
      const now = Buffer.from(await vscode.workspace.fs.readFile(created.uri)).toString('utf8');
      if (now === created.text) {
        await vscode.workspace.fs.delete(created.uri, { useTrash: false });
      }
    } catch {
      // Already gone.
    }
  };
  const write = await writes.history.write(edit, {
    label: 'Move to…',
    description: `Moved to ${target.name}`,
    preview: getWritePreview() === 'always' ? 'always' : 'never',
    restore: deleteCreated,
  });
  if (!write.applied) {
    await deleteCreated();
    void reportFailure({ outcome: 'Deckard could not move it, so nothing was written.' });
    return;
  }
  // A task moved to another note keeps its place on the board.
  if (insertedAt !== undefined && sources.every((source) => source.uri.toString() !== target.uri.toString())) {
    const targetPath = indexer.getFilePath(target.uri);
    let line = insertedAt;
    for (const source of sources) {
      const first = dedentBlock(source.block.lines)[0];
      if (source.task) {
        writes.tasks.keep(rankMoveTo(source.task.id, {
          filePath: targetPath,
          lineNumber: line + 1,
          lineText: first,
        }));
      }
      line += source.block.lines.length;
    }
  }
  if (target.heading) {
    const pin = createPinForLine(indexer.getSnapshot(), target.heading.filePath, target.heading.line);
    if (pin?.heading) {
      await preferences.recordRecentHeading(pin);
    }
  }
  announceMove(sources, target, created !== undefined, write.handle);
}

async function resolveTarget(
  indexer: WorkspaceIndexer<vscode.Uri>,
  destination: Destination,
  sources: readonly MoveSource[],
): Promise<ResolvedTarget | undefined> {
  if (destination.kind === 'today') {
    const folder = await chooseTargetFolder();
    if (!folder) {
      return undefined;
    }
    const uri = await ensureDailyNote(folder);
    const title = noteTitle(uri.path);
    return { uri, link: title, name: title };
  }
  if (destination.kind === 'newNote') {
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

/** What Move to… leaves behind, from `deckard.moveTo.leaveBehind`. */
function readLeaveBehind(): LeaveBehind {
  return vscode.workspace.getConfiguration('deckard').get<string>('moveTo.leaveBehind', 'link') === 'nothing'
    ? 'nothing'
    : 'link';
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
  indexer: WorkspaceIndexer<vscode.Uri>,
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
  public constructor(private readonly indexer: Pick<WorkspaceIndexer, 'isNotesFile'>) {}

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
