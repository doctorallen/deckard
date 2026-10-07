import * as vscode from 'vscode';
import { MessageAction, noteName, reportFailure } from './notify';

import {
  CaptureLineOptions,
  formatCaptureLine,
  getCaptureInsertion,
  writeCapture,
} from '../../domain/capture/captureLines';
import { readDateOptions } from './datePrompt';
import { PERSON_MARKER } from '../../domain/markdown/parser';
import { pickDestination } from './destinationPicker';
import { captureSeed, withSourceLink } from './selectionSeed';
import type { IndexReader } from '../../core/workspace/indexReader';
import { chooseTargetFolder, ensureDailyNote } from './dailyNote';
import { resolveSourceUri } from './navigation';
import { readTaskMetadataFormat } from './taskActions';
import {
  CaptureDrafts,
  CaptureNotes,
  CaptureResult,
  CaptureService,
  CaptureTarget,
  HeadingCaptureResult,
} from '../../services/captureService';
import { CaptureAnswer, CaptureBox, CaptureButton, CaptureRow } from './captureBox';
import { PreferencesReader } from '../../core/storage/preferencesRepository';
import { Section } from '../../domain/model';

interface CaptureItem extends vscode.QuickPickItem {
  action: CaptureRow['action'];
}

/** What the Capture commands ask and write through. */
export interface CaptureContext {
  indexer: IndexReader;
  captures: CaptureService<vscode.Uri>;
  drafts: CaptureDrafts;
  /** The recent headings and view counts the heading picker ranks by. */
  preferences: Pick<PreferencesReader, 'value'>;
}

/**
 * The notes a capture is written into, as VS Code has them: a path resolved
 * against the workspace folders, a note parsed as its editor holds it, and
 * a line added through the editor's copy and saved.
 */
export function createCaptureNotes(indexer: Pick<IndexReader, 'parse'>): CaptureNotes<vscode.Uri> {
  return {
    uriOf: (filePath) => resolveSourceUri(filePath),
    sectionsOf: async (uri) =>
      indexer.parse(uri, (await vscode.workspace.openTextDocument(uri)).getText()).sections,
    append: (uri, line, section) => appendCapture(uri, line, section),
  };
}

/**
 * Asks for a task and adds it to today's daily note, or under a heading the
 * user picks, without moving focus from the current editor. Where it goes,
 * and what becomes of the draft, is CaptureService's to decide.
 */
export async function capture(
  context: CaptureContext,
  initialTarget: CaptureTarget = 'today',
): Promise<void> {
  const { indexer, drafts, preferences, captures } = context;
  await indexer.ready;
  // Words selected in the editor are the newer and plainer intent, so they
  // win over a draft, which is offered beside them instead.
  const seed = captureSeed(
    vscode.window.activeTextEditor,
    indexer.getSnapshot(),
    (uri) => (indexer.isNotesFile(uri) ? indexer.getFilePath(uri) : undefined),
  );
  const answer = await askForCapture(
    new CaptureBox({
      initialTarget,
      draft: drafts.read(initialTarget),
      seed,
      tags: [...indexer.getSnapshot().tags.values()],
      personMarker: PERSON_MARKER,
      preview: (text, literal, link) =>
        withSourceLink(writeCapture(text, { ...readCaptureOptions(Date.now()), literal, asNote: false }), link),
    }),
    drafts,
  );
  if (!answer) {
    return;
  }
  const options = readCaptureOptions(Date.now());
  const line = withSourceLink(
    writeCapture(answer.text, { ...options, literal: answer.literal, asNote: answer.asNote }),
    answer.link,
    options.format,
  );

  if (answer.target === 'today') {
    const folder = await chooseTargetFolder();
    if (!folder) {
      return;
    }
    announce(await captures.captureToToday(await ensureDailyNote(folder), line), line);
    return;
  }

  const destination = await pickDestination(indexer.getSnapshot(), preferences, {
    title: 'Deckard: Capture Under a Heading',
    placeholder: 'Choose the heading to add it under',
  });
  if (destination?.kind !== 'heading') {
    return;
  }
  reportHeadingCapture(await captures.captureUnderHeading(line, destination.section), destination.section, line);
}

/**
 * What a capture is read with, as the settings and the display language say
 * now, at the moment `now`: the one reading of the options every capture
 * line is written with.
 */
export function readCaptureOptions(now: number): Omit<CaptureLineOptions, 'literal' | 'asNote'> {
  return {
    format: readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard')),
    now,
    dateOptions: readDateOptions(),
  };
}

/**
 * The line a capture is written as, read on the day `now` falls on, with the
 * settings as they are now. Find's Capture row writes through this too, so
 * it shows the same line.
 */
export function formatCapture(
  text: string,
  now: number,
  options: { literal?: boolean; asNote?: boolean } = {},
): string {
  return writeCapture(text, {
    ...readCaptureOptions(now),
    literal: options.literal === true,
    asNote: options.asNote === true,
  });
}

/**
 * Adds a line to a note through the editor's copy of it, so an open note keeps
 * its unsaved changes, and saves it without showing it. Returns the line the
 * task is on, or undefined when the edit was refused.
 */
export async function appendCapture(
  uri: vscode.Uri,
  line: string,
  section?: Pick<Section, 'startLine' | 'endLine'>,
): Promise<number | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  const insertion = getCaptureInsertion(document.getText(), line, section);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    uri,
    new vscode.Position(insertion.line, insertion.character),
    insertion.text,
  );
  if (!(await vscode.workspace.applyEdit(edit))) {
    return undefined;
  }
  await document.save();
  return insertion.taskLine;
}

/**
 * Adds a task to today's daily note, creating the note when needed, and says
 * where it went. Returns whether it was added. Find, Home, and the board
 * capture through this; none of them keeps a draft.
 */
export async function captureToToday(
  text: string,
  line: string = formatCaptureLine(text),
): Promise<boolean> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return false;
  }
  const uri = await ensureDailyNote(folder);
  const taskLine = await appendCapture(uri, line);
  announce(taskLine === undefined ? { kind: 'refused', uri } : { kind: 'added', uri, taskLine }, line);
  return taskLine !== undefined;
}

/** The six title-bar buttons of one Capture box, by what each does. */
function createButtons(): Record<CaptureButton, vscode.QuickInputButton> {
  return {
    heading: { iconPath: new vscode.ThemeIcon('list-tree'), tooltip: 'Add under a heading instead' },
    today: { iconPath: new vscode.ThemeIcon('calendar'), tooltip: "Add to today's note instead" },
    literal: {
      iconPath: new vscode.ThemeIcon('whole-word'),
      tooltip: 'Keep the words as written: read no date or priority from them',
    },
    reading: {
      iconPath: new vscode.ThemeIcon('wand'),
      tooltip: 'Read a date, priority, or repeat rule from the last words',
    },
    unlink: { iconPath: new vscode.ThemeIcon('close'), tooltip: 'Do not link back to where this came from' },
    link: { iconPath: new vscode.ThemeIcon('link'), tooltip: 'Link back to where this came from' },
  };
}

/**
 * Shows the Capture box. What the box says and what each event means is
 * the CaptureBox's; this forwards the Quick Pick's events to it, draws what
 * it answers, and keeps or lets go of the draft as it says.
 */
function askForCapture(box: CaptureBox, drafts: CaptureDrafts): Promise<CaptureAnswer | undefined> {
  const buttons = createButtons();
  const pressed = new Map(Object.entries(buttons).map(([id, button]) => [button, id as CaptureButton]));
  const picker = vscode.window.createQuickPick<CaptureItem>();
  picker.placeholder =
    'A task to add, such as Call Ren about the #project/atlas budget friday p2';
  // A word is often looked up in a note while Capture is open, so clicking
  // into the editor or a view leaves the box open; Escape closes it.
  picker.ignoreFocusOut = true;
  if (box.initialValue !== undefined) {
    picker.value = box.initialValue;
  }

  const update = (): void => {
    picker.title = box.title();
    picker.buttons = box.buttons().map((id) => buttons[id]);
    picker.items = box.items(picker.value);
  };

  return new Promise((resolve) => {
    picker.onDidChangeValue(() => {
      box.typed();
      update();
    });
    picker.onDidTriggerButton((button) => {
      box.press(pressed.get(button) ?? 'heading');
      update();
    });
    picker.onDidAccept(() => {
      const item = picker.activeItems[0];
      const accepted = box.accept(picker.value, item?.action, item?.label);
      if (accepted.kind === 'replace') {
        picker.value = accepted.value;
        update();
        return;
      }
      if (accepted.kind !== 'answer') {
        return;
      }
      void drafts.save(accepted.draft);
      resolve(accepted.answer);
      picker.hide();
    });
    picker.onDidHide(() => {
      const left = box.hide(picker.value);
      if (left.kind === 'save') {
        void drafts.save(left.draft);
      } else if (left.kind === 'clear') {
        void drafts.clear();
      }
      resolve(undefined);
      picker.dispose();
    });
    update();
    picker.show();
  });
}

/** Says what became of a capture under a heading, with Copy Task when it was not added. */
function reportHeadingCapture(result: HeadingCaptureResult<vscode.Uri>, chosen: Section, line: string): void {
  if (result.kind === 'missing-note') {
    void reportFailure({
      outcome: `Deckard could not find ${chosen.filePath}, so the task was not added.`,
      fix: 'It may have been moved or deleted.',
      action: copyTaskAction(line),
    });
    return;
  }
  if (result.kind === 'missing-heading') {
    void reportFailure({
      outcome: `The heading "${chosen.heading}" is no longer in ${chosen.filePath}, so the task was not added.`,
      action: copyTaskAction(line),
    });
    return;
  }
  announce(result, line);
}

/**
 * Where a note is, as a reader checks it: its path in its workspace
 * folder, and the folder's name, so a note written into the wrong
 * repository shows as such: `notes/2026-10-07.md in deckard-work`.
 */
export function describeWhere(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return uri.path.split('/').pop() ?? uri.path;
  }
  return `${vscode.workspace.asRelativePath(uri, false)} in ${folder.name}`;
}

/** Says where the task went, with a way to open it there. */
function announce(result: CaptureResult<vscode.Uri>, line: string): void {
  const { uri } = result;
  if (result.kind === 'refused') {
    void reportFailure({
      outcome: `Deckard could not add the task to ${noteName(uri)}, so nothing was written.`,
      action: copyTaskAction(line),
    });
    return;
  }
  void vscode.window
    .showInformationMessage(`Added it to ${describeWhere(uri)}.`, 'Open')
    .then((choice) => {
      if (choice !== 'Open') {
        return;
      }
      const position = new vscode.Position(result.taskLine, 0);
      void vscode.window.showTextDocument(uri, {
        preview: false,
        selection: new vscode.Range(position, position),
      });
    });
}

/** Copy Task: keeps what was typed, on the clipboard, when it could not be added. */
function copyTaskAction(line: string): MessageAction {
  return {
    title: 'Copy Task',
    run: () => vscode.env.clipboard.writeText(line.trim()),
  };
}
