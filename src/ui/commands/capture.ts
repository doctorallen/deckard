import * as vscode from 'vscode';

import { readCaptureText } from '../../core/markdown/captureWords';
import { getPersonMarker } from '../../core/markdown/parser';
import { Section, TagInfo } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { chooseTargetFolder, ensureDailyNote } from './dailyNote';
import { resolveSourceUri } from './navigation';
import { readTaskMetadataFormat } from './taskActions';

/** Where a capture goes: today's daily note, or under a chosen heading. */
export type CaptureTarget = 'today' | 'heading';

/** Where a captured line is inserted, and the line the task ends up on. */
export interface CaptureInsertion {
  line: number;
  character: number;
  text: string;
  /** The zero-based line of the added task once the text is inserted. */
  taskLine: number;
}

interface CaptureItem extends vscode.QuickPickItem {
  action: 'add' | 'note' | 'tag';
}

/** What was typed, and how it is to be written. */
interface CaptureAnswer {
  text: string;
  target: CaptureTarget;
  /** A plain list item rather than a task. */
  asNote: boolean;
  /** The words kept as typed, with no date or priority read from them. */
  literal: boolean;
}

const TAG_SUGGESTION_LIMIT = 8;
/** The word being typed: everything after the last space or opening bracket. */
const TRAILING_WORD = /[^\s([{]*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const labelCollator = new Intl.Collator();

/**
 * Asks for a task and adds it to today's daily note, or under a heading the
 * user picks, without moving focus from the current editor.
 */
export async function capture(
  indexer: WorkspaceIndexer,
  initialTarget: CaptureTarget = 'today',
): Promise<void> {
  await indexer.ready;
  const answer = await askForCapture(indexer, initialTarget);
  if (!answer) {
    return;
  }
  const line = writeCapture(answer);

  if (answer.target === 'today') {
    await captureToToday(answer.text, line);
    return;
  }

  const chosen = await pickHeading(indexer);
  if (!chosen) {
    return;
  }
  const uri = await resolveSourceUri(chosen.filePath);
  if (!uri) {
    void vscode.window.showWarningMessage(
      `Deckard could not find ${chosen.filePath}.`,
    );
    return;
  }
  // The note may have changed since it was indexed, so the heading is found
  // again in the note as it is now.
  const document = await vscode.workspace.openTextDocument(uri);
  const saved =
    indexer.getSnapshot().files.get(chosen.filePath)?.sections ?? [];
  const section = findSameSection(
    saved,
    chosen,
    indexer.parse(uri, document.getText()).sections,
  );
  if (!section) {
    void vscode.window.showWarningMessage(
      `The heading "${chosen.heading}" is no longer in ${chosen.filePath}.`,
    );
    return;
  }
  announce(uri, await appendCapture(uri, line, section));
}

/**
 * The tags that complete the word being typed when it starts with `#` or the
 * person marker: tags starting with it, then tags containing it, most used
 * first within each.
 */
export function getTagSuggestions(
  value: string,
  tags: Iterable<Pick<TagInfo, 'label' | 'count'>>,
  personMarker = '@',
  limit = TAG_SUGGESTION_LIMIT,
): string[] {
  const word = (value.match(TRAILING_WORD)?.[0] ?? '').toLowerCase();
  if (!word.startsWith('#') && !word.startsWith(personMarker)) {
    return [];
  }
  const starting: Pick<TagInfo, 'label' | 'count'>[] = [];
  const containing: Pick<TagInfo, 'label' | 'count'>[] = [];
  for (const tag of tags) {
    const label = tag.label.toLowerCase();
    if (label === word || label[0] !== word[0]) {
      continue;
    }
    if (label.startsWith(word)) {
      starting.push(tag);
    } else if (label.includes(word.slice(1))) {
      containing.push(tag);
    }
  }
  const byUse = (
    left: Pick<TagInfo, 'label' | 'count'>,
    right: Pick<TagInfo, 'label' | 'count'>,
  ) => right.count - left.count || labelCollator.compare(left.label, right.label);
  return [...starting.sort(byUse), ...containing.sort(byUse)]
    .slice(0, limit)
    .map((tag) => tag.label);
}

/** Replaces the word being typed with a chosen tag, ready for the next word. */
export function completeLastWord(value: string, label: string): string {
  return `${value.replace(TRAILING_WORD, '')}${label} `;
}

/**
 * The line a capture is written as: a note line, the task as typed, or the
 * task with the date, priority, and repeat rule its last words name.
 */
function writeCapture(answer: Omit<CaptureAnswer, 'target'>): string {
  if (answer.asNote) {
    return formatNoteLine(answer.text);
  }
  const line = formatCaptureLine(answer.text);
  return answer.literal
    ? line
    : readCaptureText(line, readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard'))).line;
}

/** Writes a capture as a plain list item, for an idea that is not a to-do. */
export function formatNoteLine(text: string): string {
  return `- ${text.trim().replace(/^[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/, '')}`;
}

/** Writes a capture as an open task, unless it is already written as a task. */
export function formatCaptureLine(text: string): string {
  const trimmed = text.trim();
  return /^[-*+] \[[ xX]\] /.test(trimmed)
    ? trimmed
    : `- [ ] ${trimmed.replace(/^[-*+]\s+/, '')}`;
}

/**
 * Places a captured line after the last list item in the note or section, or
 * after a blank line below its last text. A section's lines are one-based.
 */
export function getCaptureInsertion(
  content: string,
  line: string,
  section?: Pick<Section, 'startLine' | 'endLine'>,
): CaptureInsertion {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const first = section ? section.startLine - 1 : 0;
  let end = section
    ? Math.min(section.endLine, lines.length) - 1
    : lines.length - 1;
  while (end >= first && lines[end].trim() === '') {
    end -= 1;
  }
  if (end < first) {
    return { line: 0, character: 0, text: `${line}${eol}`, taskLine: 0 };
  }

  const gap = LIST_ITEM.test(lines[end]) ? '' : eol;
  const taskLine = end + (gap ? 2 : 1);
  if (end + 1 < lines.length) {
    return { line: end + 1, character: 0, text: `${gap}${line}${eol}`, taskLine };
  }
  // The last text ends the file without a line break.
  return {
    line: end,
    character: lines[end].length,
    text: `${eol}${gap}${line}`,
    taskLine,
  };
}

/**
 * Finds the heading chosen from the index in the note as it is now, by its
 * text, its level, and how many headings like it come before it.
 */
export function findSameSection(
  saved: readonly Section[],
  chosen: Section,
  live: readonly Section[],
): Section | undefined {
  const same = (section: Section) =>
    !section.isInline &&
    section.heading === chosen.heading &&
    section.headingLevel === chosen.headingLevel;
  const occurrence = saved
    .filter(same)
    .findIndex((section) => section.id === chosen.id);
  return occurrence < 0 ? undefined : live.filter(same)[occurrence];
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
 * where it went. Returns whether it was added.
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
  announce(uri, taskLine);
  return taskLine !== undefined;
}

/**
 * Asks for the task. The first item is always the typed text, so Enter adds
 * it as a task, with the line it will be written as under it; the second
 * adds it as a plain line. Tag suggestions follow, and choosing one
 * completes the word instead.
 */
function askForCapture(
  indexer: WorkspaceIndexer,
  initialTarget: CaptureTarget,
): Promise<CaptureAnswer | undefined> {
  const tags = [...indexer.getSnapshot().tags.values()];
  const personMarker = getPersonMarker(
    vscode.workspace.getConfiguration('deckard').get('personMarker'),
  );
  const headingButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('list-tree'),
    tooltip: 'Add under a heading instead',
  };
  const todayButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('calendar'),
    tooltip: "Add to today's note instead",
  };
  const literalButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('whole-word'),
    tooltip: 'Keep the words as written: read no date or priority from them',
  };
  const readingButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('wand'),
    tooltip: 'Read a date, priority, or repeat rule from the last words',
  };
  let literal = false;
  const picker = vscode.window.createQuickPick<CaptureItem>();
  picker.placeholder =
    'A task to add, such as Call Ren about the #project/atlas budget friday p2';
  let target = initialTarget;

  const update = (): void => {
    picker.title =
      target === 'today' ? 'Deckard: Capture' : 'Deckard: Capture Under a Heading';
    picker.buttons = [
      literal ? readingButton : literalButton,
      target === 'today' ? headingButton : todayButton,
    ];
    const value = picker.value.trim();
    const suggestions = getTagSuggestions(picker.value, tags, personMarker).map(
      (label): CaptureItem => ({
        label,
        description: 'Complete the tag',
        alwaysShow: true,
        action: 'tag',
      }),
    );
    const written = value ? writeCapture({ text: value, asNote: false, literal }) : '';
    const add: CaptureItem = {
      label: value,
      description:
        target === 'today' ? "Add to today's note" : 'Choose a heading next',
      // The line as it will be written, so a date read from the words is
      // seen before it is saved, and the button above keeps them instead.
      detail: written && written !== formatCaptureLine(value) ? written : undefined,
      alwaysShow: true,
      action: 'add',
    };
    const note: CaptureItem = {
      label: 'Add as a note line',
      description: formatNoteLine(value),
      alwaysShow: true,
      action: 'note',
    };
    picker.items = value ? [add, note, ...suggestions] : suggestions;
  };

  return new Promise((resolve) => {
    picker.onDidChangeValue(update);
    picker.onDidTriggerButton((button) => {
      if (button === literalButton || button === readingButton) {
        literal = !literal;
      } else {
        target = target === 'today' ? 'heading' : 'today';
      }
      update();
    });
    picker.onDidAccept(() => {
      const item = picker.activeItems[0];
      if (item?.action === 'tag') {
        picker.value = completeLastWord(picker.value, item.label);
        update();
        return;
      }
      const text = picker.value.trim();
      if (text) {
        resolve({ text, target, literal, asNote: item?.action === 'note' });
        picker.hide();
      }
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
    update();
    picker.show();
  });
}

/** Lists every heading in the notes, the most recently updated notes first. */
async function pickHeading(
  indexer: WorkspaceIndexer,
): Promise<Section | undefined> {
  const files = [...indexer.getSnapshot().files.values()].sort(
    (left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
      labelCollator.compare(left.filePath, right.filePath),
  );
  const items = files.flatMap((file) =>
    file.sections
      .filter((section) => !section.isInline)
      .map((section) => ({
        label: section.heading,
        description: file.filePath,
        section,
      })),
  );
  if (items.length === 0) {
    void vscode.window.showInformationMessage(
      'There are no headings in your notes yet.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Deckard: Capture Under a Heading',
    placeHolder: 'Choose the heading to add the task under',
    matchOnDescription: true,
  });
  return picked?.section;
}

/** Says where the task went, with a way to open it there. */
function announce(uri: vscode.Uri, taskLine: number | undefined): void {
  if (taskLine === undefined) {
    void vscode.window.showWarningMessage('Deckard could not add the capture.');
    return;
  }
  const name = uri.path.split('/').pop() ?? uri.path;
  void vscode.window
    .showInformationMessage(`Added it to ${name}.`, 'Open')
    .then((choice) => {
      if (choice === 'Open') {
        const position = new vscode.Position(taskLine, 0);
        void vscode.window.showTextDocument(uri, {
          preview: false,
          selection: new vscode.Range(position, position),
        });
      }
    });
}
