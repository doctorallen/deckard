import * as vscode from 'vscode';
import { MessageAction, noteName, reportFailure } from './notify';

import {
  CaptureLineOptions,
  formatCaptureLine,
  getCaptureInsertion,
  writeCapture,
} from '../../domain/capture/captureLines';
import { readDateOptions } from './datePrompt';
import type { IndexReader } from '../../core/workspace/indexReader';
import { chooseTargetFolder, ensureDailyNote } from './dailyNote';
import { resolveSourceUri } from './navigation';
import { readTaskMetadataFormat } from './taskActions';
import { CaptureNotes, CaptureResult, HeadingCaptureResult } from '../../services/captureService';
import { Section } from '../../domain/model';

/**
 * Writing a line into a note and saying where it went: what Add Task,
 * Find's Add row, Home's Quick add, and a next action share.
 */

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
 * The line typed words are written as, read on the day `now` falls on, with
 * the settings as they are now: Find's Add row shows and writes this line.
 */
export function formatCapture(text: string, now: number): string {
  return writeCapture(text, readCaptureOptions(now));
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
 * where it went. Returns whether it was added. Find's Add row, Home's Quick
 * add, and a next action write through this.
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

/** Says what became of a task added under a heading, with Copy Task when it was not added. */
export function reportHeadingCapture(result: HeadingCaptureResult<vscode.Uri>, chosen: Section, line: string): void {
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
export function announce(result: CaptureResult<vscode.Uri>, line: string): void {
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
