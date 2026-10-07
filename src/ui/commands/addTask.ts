import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import type { PreferencesReader } from '../../core/storage/preferencesRepository';
import type { CaptureService } from '../../services/captureService';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { stripTags } from '../../domain/markdown/parser';
import { formatTaskDraft, isTaskLine, parseTaskDraft, TaskDraft } from '../../domain/markdown/taskDraft';
import { Section } from '../../domain/model';
import {
  describeTaskTarget,
  HerePlacement,
  listNoteChoices,
  listTaskTargetChoices,
  NoteChoice,
  placeTaskHere,
  TaskTargetChoice,
  TaskTargetKind,
  titleTaskTarget,
} from '../state/addTaskTarget';
import { announce, reportHeadingCapture } from './capture';
import { chooseTargetFolder, ensureDailyNote, nameTodaysNote } from './dailyNote';
import { pickDestination } from './destinationPicker';
import { resolveSourceUri } from './navigation';
import { describeRejectedEdit, noteName, reportFailure } from './notify';
import { showQuickPickUntilHidden } from './prompts';
import { captureSeed, CaptureSeed, withSourceLink } from './selectionSeed';
import { readTaskMetadataFormat } from './taskActions';
import {
  DraftNote,
  DraftStatusReading,
  editTaskDraft,
  lineStillReads,
  readDraftStatusReading,
  sayCompletion,
  writeEditedTask,
} from './taskEditor';

/**
 * Add Task: a new task, written in the task editor, into the note in the
 * active editor or into today's daily note, or into another note or under a
 * heading, as the editor's Note row says.
 *
 * It took the place of Capture, which asked for one line and wrote it into
 * today's note. The editor's Note row keeps that: with no note open, the
 * task goes into today's note, made from its template when it is missing,
 * after its last list item or text, and the title says so before anything
 * is written. A message says where it went once it is, as Capture's did.
 */

/** What Add Task reads and writes through. */
export interface AddTaskContext {
  indexer: IndexReader;
  /** Writes into a note, or under a heading, and remembers the heading. */
  captures: CaptureService<vscode.Uri>;
  /** The recent headings and view counts the heading picker ranks by. */
  preferences: Pick<PreferencesReader, 'value'>;
}

/** What Add Task starts from besides the editor: the line a board column starts a task as. */
export interface AddTaskStart {
  line?: string;
}

/** Where the new task goes, with what writing it there needs. */
type AddTarget =
  | { kind: 'here'; path: string; editor: vscode.TextEditor; anchor: vscode.TextLine; placement: HerePlacement }
  | { kind: 'today'; path: string }
  | { kind: 'note'; path: string; filePath: string }
  | { kind: 'heading'; path: string; heading: string; section: Section };

/** A list item's marker, which a plain line made into a task does not keep in its words. */
const LIST_MARKER = /^(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Opens the task editor on a new task and writes it where the Note row
 * says: by default into the Markdown note in the active editor, at the
 * cursor, and into today's note when no note is open. Returns the line
 * written, or undefined when nothing was.
 */
export async function addTaskCommand(
  context: AddTaskContext,
  start: AddTaskStart = {},
  now: number = Date.now(),
): Promise<string | undefined> {
  const { indexer } = context;
  await indexer.ready;
  const active = vscode.window.activeTextEditor;
  const editor = active && isMarkdownFile(active.document.uri) ? active : undefined;
  // Words selected in any editor start the task, with a link back to where
  // they were when it is written into another note.
  const seed = captureSeed(active, indexer.getSnapshot(), (uri) =>
    indexer.isNotesFile(uri) ? indexer.getFilePath(uri) : undefined,
  );
  const scope = editor?.document.uri;
  const format = readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', scope));
  const status = readDraftStatusReading(scope);
  const here = editor ? targetHere(editor, Boolean(seed || start.line)) : undefined;
  const today = await nameTodaysNote(new Date(now));
  const initial = startDraft({ start, seed, here, format, status });

  let target: AddTarget = here ?? { kind: 'today', path: today };
  const note: DraftNote = {
    title: () => titleTaskTarget(target),
    describe: () => describeTaskTarget(target),
    choose: async () => {
      target = (await chooseTarget(context, target, { here, today })) ?? target;
    },
  };
  const edited = await editTaskDraft(initial, {
    title: 'Add task',
    index: indexer,
    now,
    status,
    note,
    readWords: true,
    preview: (draft) => lineFor(draft, target, seed),
  });
  if (!edited) {
    return undefined;
  }
  if (target.kind === 'here') {
    return writeHere(target, initial, edited, now);
  }
  const text = writeEditedTask({ before: initial, edited, now, eol: '\n' }).text;
  return writeElsewhere(context, target, withSourceLink(indentLines(text), seed?.link, edited.format));
}

/**
 * A path as Deckard writes paths, with `/`: VS Code gives a note outside
 * the workspace folders by its full path, with backslashes on Windows.
 */
function slashPath(path: string): string {
  return process.platform === 'win32' ? path.split('\\').join('/') : path;
}

/** The note in `editor` as a place for the task, at its cursor's line. */
function targetHere(editor: vscode.TextEditor, seeded: boolean): Extract<AddTarget, { kind: 'here' }> {
  const anchor = editor.document.lineAt(editor.selection.active.line);
  return {
    kind: 'here',
    path: slashPath(vscode.workspace.asRelativePath(editor.document.uri, false)),
    editor,
    anchor,
    placement: placeTaskHere(anchor.text, { isTask: isTaskLine(anchor.text), seeded }),
  };
}

/**
 * The task the editor opens on: the line a board column made, the words
 * selected, the words of the cursor's line when it becomes the task, or an
 * empty one, as deep in the note as the place it would be written.
 */
function startDraft({
  start,
  seed,
  here,
  format,
  status,
}: {
  start: AddTaskStart;
  seed: CaptureSeed | undefined;
  here: Extract<AddTarget, { kind: 'here' }> | undefined;
  format: ReturnType<typeof readTaskMetadataFormat>;
  status: DraftStatusReading;
}): TaskDraft {
  const placement = here?.placement;
  const indent =
    placement?.mode === 'below' ? placement.indent : (/^\s*/.exec(here?.anchor.text ?? '')?.[0] ?? '');
  if (start.line !== undefined) {
    return indentDraft(parseTaskDraft(start.line, format, status.statuses), indent);
  }
  if (seed) {
    return { ...parseTaskDraft(indent, format, status.statuses), description: seed.text };
  }
  if (here && placement?.mode === 'line') {
    const draft = parseTaskDraft(here.anchor.text, format, status.statuses);
    return { ...draft, description: draft.description.replace(LIST_MARKER, '') };
  }
  return parseTaskDraft(indent, format, status.statuses);
}

/** A draft written at `indent`, its box and marker kept. */
function indentDraft(draft: TaskDraft, indent: string): TaskDraft {
  return { ...draft, prefix: `${indent}${draft.prefix.trimStart()}` };
}

/**
 * The line as it will be written there: at the left edge of another note,
 * with a link back to the words selected, and as deep as its place here.
 */
function lineFor(draft: TaskDraft, target: AddTarget, seed: CaptureSeed | undefined): string {
  if (target.kind === 'here') {
    return formatTaskDraft(draft);
  }
  return withSourceLink(formatTaskDraft(indentDraft(draft, '')), seed?.link, draft.format);
}

/**
 * Asks where the task goes instead: this note, today's, another note, or
 * under a heading. Undefined when the reader leaves without choosing.
 */
async function chooseTarget(
  context: AddTaskContext,
  current: AddTarget,
  places: { here: Extract<AddTarget, { kind: 'here' }> | undefined; today: string },
): Promise<AddTarget | undefined> {
  const choices = listTaskTargetChoices(current, { here: places.here?.path, today: places.today });
  const chosen = await showQuickPickUntilHidden<TaskTargetChoice & vscode.QuickPickItem, TaskTargetKind>({
    configure: (pick) => {
      pick.title = 'Where should the task go?';
      pick.placeholder = 'Choose a note, or a heading in one';
      pick.items = choices;
      pick.activeItems = choices.filter((choice) => choice.target === current.kind);
      pick.ignoreFocusOut = true;
    },
    accept: (pick) => pick.selectedItems[0]?.target,
  });
  switch (chosen) {
    case 'here':
      return places.here;
    case 'today':
      return { kind: 'today', path: places.today };
    case 'note':
      return pickNote(context);
    case 'heading':
      return pickHeading(context);
    case undefined:
      return undefined;
  }
}

/** Another note, from every indexed note, the one changed last first. */
async function pickNote(context: AddTaskContext): Promise<AddTarget | undefined> {
  const items = listNoteChoices(context.indexer.getSnapshot().files.values());
  if (items.length === 0) {
    void vscode.window.showInformationMessage('There are no notes to add a task to yet.');
    return undefined;
  }
  const chosen = await showQuickPickUntilHidden<NoteChoice & vscode.QuickPickItem, NoteChoice>({
    configure: (pick) => {
      pick.title = 'Add the task to which note?';
      pick.placeholder = 'Type to find a note; the notes changed last come first';
      pick.matchOnDescription = true;
      pick.items = items;
      pick.ignoreFocusOut = true;
    },
    accept: (pick) => pick.selectedItems[0],
  });
  return chosen && { kind: 'note', path: chosen.filePath, filePath: chosen.filePath };
}

/** A heading in any note, the ones used last first, as Move to… offers them. */
async function pickHeading(context: AddTaskContext): Promise<AddTarget | undefined> {
  const destination = await pickDestination(context.indexer.getSnapshot(), context.preferences, {
    title: 'Add the task under which heading?',
    placeholder: 'Choose the heading to add it under',
  });
  if (destination?.kind !== 'heading') {
    return undefined;
  }
  const { section } = destination;
  return {
    kind: 'heading',
    path: section.filePath,
    heading: stripTags(section.heading).trim() || section.heading,
    section,
  };
}

/**
 * Writes the task into the note being edited: on the cursor's line, or on
 * a new line below it, through the note's own copy, so one undo takes it
 * back and the note keeps its other unsaved changes. Nothing is written
 * when the line changed while the editor was open.
 */
async function writeHere(
  target: Extract<AddTarget, { kind: 'here' }>,
  initial: TaskDraft,
  edited: TaskDraft,
  now: number,
): Promise<string | undefined> {
  const { editor, anchor, placement } = target;
  const { document } = editor;
  if (!lineStillReads(document, anchor, 'Add Task')) {
    return undefined;
  }
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const completion = writeEditedTask({ before: initial, edited, now, eol });
  const written = completion.text;
  const edit = new vscode.WorkspaceEdit();
  if (placement.mode === 'line') {
    edit.replace(document.uri, anchor.range, written);
  } else {
    edit.insert(document.uri, anchor.range.end, `${eol}${written}`);
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    void reportFailure(describeRejectedEdit(noteName(document.uri)));
    return undefined;
  }
  // The caret goes to the end of the description, where writing continues,
  // when the note is still the one being edited.
  const line = anchor.lineNumber + (placement.mode === 'below' ? 1 : 0) + (completion.next === undefined ? 0 : 1);
  const still = vscode.window.activeTextEditor;
  if (still?.document === document) {
    const caret = new vscode.Position(
      line,
      Math.min(formatTaskDraft(edited).length, edited.prefix.length + edited.description.length),
    );
    still.selection = new vscode.Selection(caret, caret);
  }
  sayCompletion(edited, completion);
  vscode.window.setStatusBarMessage(`Added it to ${target.path}, line ${line + 1}.`, 5000);
  return written;
}

/**
 * Writes the task's `line` into today's note, another note, or under a
 * heading, and says where it went, with Open. Today's note is made from its template
 * when it is missing, in the folder of the note being edited or the one
 * chosen.
 */
async function writeElsewhere(
  context: AddTaskContext,
  target: Exclude<AddTarget, { kind: 'here' }>,
  line: string,
): Promise<string | undefined> {
  const { captures } = context;
  if (target.kind === 'heading') {
    const result = await captures.captureUnderHeading(line, target.section);
    reportHeadingCapture(result, target.section, line);
    return result.kind === 'added' ? line : undefined;
  }
  const uri = target.kind === 'today' ? await todaysNote() : await resolveSourceUri(target.filePath);
  if (!uri) {
    if (target.kind === 'note') {
      void reportFailure({
        outcome: `Deckard could not find ${target.filePath}, so the task was not added.`,
        fix: 'It may have been moved or deleted.',
      });
    }
    return undefined;
  }
  const result = await captures.captureToNote(uri, line);
  announce(result, line);
  return result.kind === 'added' ? line : undefined;
}

/** Today's note, made when it is missing; undefined when no folder was settled. */
async function todaysNote(): Promise<vscode.Uri | undefined> {
  const folder = await chooseTargetFolder();
  return folder ? ensureDailyNote(folder) : undefined;
}

/** The lines of a task taken to the left edge, for another note. */
function indentLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n');
}
