import * as vscode from 'vscode';
import { MessageAction, noteName, reportFailure } from './notify';

import { readCaptureText } from '../../domain/markdown/captureWords';
import { isTaskLineOf, TaskLineShape } from '../../domain/markdown/lineShapes';
import { readDateOptions } from './datePrompt';
import { getPersonMarker } from '../../domain/markdown/parser';
import { Section, TagInfo } from '../../core/types';
import { PreferencesStore } from '../../core/storage/preferences';
import { createPinForLine } from '../state/pinnedNotes';
import { pickDestination } from './destinationPicker';
import { CaptureSeed, captureSeed, withSourceLink } from './selectionSeed';
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
  action: 'add' | 'note' | 'tag' | 'restore';
}

/** What was typed, and how it is to be written. */
interface CaptureAnswer {
  text: string;
  target: CaptureTarget;
  /** A plain list item rather than a task. */
  asNote: boolean;
  /** The words kept as typed, with no date or priority read from them. */
  literal: boolean;
  /** A link back to where the words were selected, written after them. */
  link?: string;
}

/** What was being typed when Capture closed without writing it. */
export interface CaptureDraft {
  text: string;
  target: CaptureTarget;
  literal: boolean;
}

const DRAFT_KEY = 'deckard.capture.draft';

/**
 * Keeps what was typed into Capture until it is written, so closing the box,
 * or another quick input taking its place, does not lose the words.
 */
export class CaptureDrafts {
  public constructor(private readonly memory: Pick<vscode.Memento, 'get' | 'update'>) {}

  /** The draft, when it was typed into the same command. */
  public read(target: CaptureTarget): CaptureDraft | undefined {
    const draft = this.memory.get<CaptureDraft>(DRAFT_KEY);
    return draft &&
      typeof draft.text === 'string' &&
      draft.text.trim() !== '' &&
      draft.target === target
      ? { text: draft.text, target, literal: draft.literal === true }
      : undefined;
  }

  public save(draft: CaptureDraft): Thenable<void> {
    return this.memory.update(DRAFT_KEY, draft);
  }

  public clear(): Thenable<void> {
    return this.memory.update(DRAFT_KEY, undefined);
  }
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
  drafts?: CaptureDrafts,
  preferences?: PreferencesStore,
): Promise<void> {
  await indexer.ready;
  // Words selected in the editor are the newer and plainer intent, so they
  // win over a draft, which is offered beside them instead.
  const seed = captureSeed(
    vscode.window.activeTextEditor,
    indexer.getSnapshot(),
    (uri) => (indexer.isNotesFile(uri) ? indexer.getFilePath(uri) : undefined),
  );
  const answer = await askForCapture(
    indexer,
    initialTarget,
    drafts?.read(initialTarget),
    drafts,
    seed,
  );
  if (!answer) {
    return;
  }
  const line = withSourceLink(
    writeCapture(answer, Date.now()),
    answer.link,
    readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard')),
  );

  if (answer.target === 'today') {
    if (await captureToToday(answer.text, line)) {
      await drafts?.clear();
    }
    return;
  }

  const destination = await pickDestination(
    indexer.getSnapshot(),
    preferences,
    {
      title: 'Deckard: Capture Under a Heading',
      placeholder: 'Choose the heading to add it under',
    },
  );
  if (destination?.kind !== 'heading') {
    return;
  }
  const chosen = destination.section;
  const uri = await resolveSourceUri(chosen.filePath);
  if (!uri) {
    void reportFailure({
      outcome: `Deckard could not find ${chosen.filePath}, so the task was not added.`,
      fix: 'It may have been moved or deleted.',
      action: copyTaskAction(line),
    });
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
    void reportFailure({
      outcome: `The heading "${chosen.heading}" is no longer in ${chosen.filePath}, so the task was not added.`,
      action: copyTaskAction(line),
    });
    return;
  }
  // Under the heading's own lines, above any heading nested in it.
  const taskLine = await appendCapture(uri, line, {
    startLine: section.startLine,
    endLine: section.bodyEndLine,
  });
  if (taskLine !== undefined) {
    await drafts?.clear();
    const pin = createPinForLine(indexer.getSnapshot(), chosen.filePath, chosen.startLine);
    if (pin?.heading) {
      await preferences?.recordRecentHeading(pin);
    }
  }
  announce(uri, taskLine, line);
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
 * task with the date, priority, and repeat rule its last words name, read
 * on the day `now` falls on. Find's Capture row writes through this too, so
 * it shows the same line.
 */
export function formatCapture(
  text: string,
  now: number,
  options: { literal?: boolean; asNote?: boolean } = {},
): string {
  return writeCapture({ text, literal: options.literal === true, asNote: options.asNote === true }, now);
}

/** The line for an answer, its dates read on the day `now` falls on. */
function writeCapture(answer: Omit<CaptureAnswer, 'target'>, now: number): string {
  if (answer.asNote) {
    return formatNoteLine(answer.text);
  }
  const line = formatCaptureLine(answer.text);
  return answer.literal
    ? line
    : readCaptureText(
        line,
        readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard')),
        now,
        readDateOptions(),
      ).line;
}

/** Writes a capture as a plain list item, for an idea that is not a to-do. */
export function formatNoteLine(text: string): string {
  return `- ${text.trim().replace(/^[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/, '')}`;
}

/** A task written as Deckard writes one: no indent, and one space either side of the box. */
const WRITTEN_TASK: TaskLineShape = { indent: 'none', bulletGap: 'one-space', marks: ' xX', after: 'one-space' };

/** Writes a capture as an open task, unless it is already written as a task. */
export function formatCaptureLine(text: string): string {
  const trimmed = text.trim();
  return isTaskLineOf(trimmed, WRITTEN_TASK)
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
  announce(uri, taskLine, line);
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
  draft?: CaptureDraft,
  drafts?: CaptureDrafts,
  seed?: CaptureSeed,
): Promise<CaptureAnswer | undefined> {
  // A selection wins; the draft waits as the second row until it is chosen.
  const restored = seed ? undefined : draft;
  let offeredDraft = seed ? draft : undefined;
  let link = seed?.link;
  let linkBack = link !== undefined;
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
  const unlinkButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('close'),
    tooltip: 'Do not link back to where this came from',
  };
  const linkButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('link'),
    tooltip: 'Link back to where this came from',
  };
  let literal = restored?.literal ?? false;
  const picker = vscode.window.createQuickPick<CaptureItem>();
  picker.placeholder =
    'A task to add, such as Call Ren about the #project/atlas budget friday p2';
  // Clicking into the editor or a view no longer closes the box; Escape does.
  picker.ignoreFocusOut = true;
  let target = initialTarget;
  // Said in the title until the first keystroke, so restored words are not
  // mistaken for a stray paste.
  let restoring = restored !== undefined;
  if (restored) {
    picker.value = restored.text;
  } else if (seed) {
    picker.value = seed.text;
  }

  const update = (): void => {
    picker.title =
      (target === 'today' ? 'Deckard: Capture' : 'Deckard: Capture Under a Heading') +
      (restoring ? ' — Restored what you were typing' : '');
    picker.buttons = [
      ...(link ? [linkBack ? unlinkButton : linkButton] : []),
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
    const written = value
      ? withSourceLink(writeCapture({ text: value, asNote: false, literal }, Date.now()), linkBack ? link : undefined)
      : '';
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
    const restore: CaptureItem[] = offeredDraft && offeredDraft.text !== value
      ? [
          {
            label: 'Restore what you were typing',
            description: offeredDraft.text,
            alwaysShow: true,
            action: 'restore',
          },
        ]
      : [];
    picker.items = value ? [add, ...restore, note, ...suggestions] : [...restore, ...suggestions];
  };

  return new Promise((resolve) => {
    let accepted = false;
    picker.onDidChangeValue(() => {
      restoring = false;
      update();
    });
    picker.onDidTriggerButton((button) => {
      if (button === linkButton || button === unlinkButton) {
        linkBack = !linkBack;
      } else if (button === literalButton || button === readingButton) {
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
      if (item?.action === 'restore' && offeredDraft) {
        // The draft's words replace the selection's, which it had no link to.
        picker.value = offeredDraft.text;
        literal = offeredDraft.literal;
        offeredDraft = undefined;
        link = undefined;
        linkBack = false;
        update();
        return;
      }
      const text = picker.value.trim();
      if (text) {
        accepted = true;
        // Kept until it is written: a heading picker closed, or a note that
        // refuses the edit, would otherwise lose it.
        void drafts?.save({ text, target, literal });
        resolve({
          text,
          target,
          literal,
          asNote: item?.action === 'note',
          ...(linkBack && link ? { link } : {}),
        });
        picker.hide();
      }
    });
    picker.onDidHide(() => {
      if (!accepted) {
        const text = picker.value.trim();
        // Selected words left as they were are not a draft; the draft kept
        // for the next Capture stays.
        if (!(seed && text === seed.text)) {
          void (text ? drafts?.save({ text, target, literal }) : drafts?.clear());
        }
      }
      resolve(undefined);
      picker.dispose();
    });
    update();
    picker.show();
  });
}

/** Says where the task went, with a way to open it there. */
function announce(uri: vscode.Uri, taskLine: number | undefined, line: string): void {
  if (taskLine === undefined) {
    void reportFailure({
      outcome: `Deckard could not add the task to ${noteName(uri)}, so nothing was written.`,
      action: copyTaskAction(line),
    });
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

/** Copy Task: keeps what was typed, on the clipboard, when it could not be added. */
function copyTaskAction(line: string): MessageAction {
  return {
    title: 'Copy Task',
    run: () => vscode.env.clipboard.writeText(line.trim()),
  };
}
