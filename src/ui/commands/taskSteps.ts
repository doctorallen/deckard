import * as vscode from 'vscode';

import { isTaskLineOf, TaskLineShape } from '../../core/markdown/lineShapes';
import { parseTaskMetadata } from '../../core/markdown/taskMetadata';
import {
  findCheckboxColumn,
  findStepFamily,
  formatStepLines,
  isCheckedTaskLine,
  parseSuggestedSteps,
  planStepInsertion,
  splitTypedSteps,
} from '../../core/markdown/taskSteps';
import { measureAsync, reportError } from '../../core/timing';
import { Task } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveSourceUri } from './navigation';
import { describeRejectedEdit, noteName, reindexAction, reportFailure, reportStale } from './notify';
import { quoteTitle, readIndexedTaskLine } from './taskActions';
import { applyWorkspaceWrite, reportUndo, workspaceWrites } from './workspaceWrites';

/**
 * Break into Steps…: a list that grows one step per Enter, shown with the
 * steps already written, and written under the task as `- [ ]` lines in one
 * change that Undo takes back.
 */

/** The task steps are written under: what the index or the editor knows of it. */
export type StepTarget = Pick<
  Task,
  'filePath' | 'lineNumber' | 'sourceLineText' | 'checkboxColumn' | 'checkboxValue' | 'title'
>;

/** A model that can suggest steps, and how the list names it. */
export interface StepSuggester {
  /** The model to offer, or undefined when there is none or it is turned off. */
  model(): Promise<{ label: string; vendor?: string } | undefined>;
  /** Steps for a task's words; throws with a message to show when it cannot. */
  suggest(title: string, token: vscode.CancellationToken): Promise<string[]>;
}

/** A step written under the task already, shown so it is not typed twice. */
export interface WrittenStep {
  title: string;
  done: boolean;
}

/** One new step in the list, and whether a model suggested it. */
export interface NewStep {
  text: string;
  suggested: boolean;
}

/** What a row of the list does when it is chosen. */
export type StepRow =
  | { kind: 'add' }
  | { kind: 'change'; index: number }
  | { kind: 'written' }
  | { kind: 'new'; index: number }
  | { kind: 'write' }
  | { kind: 'suggest' }
  | { kind: 'separator' };

export interface StepItem extends vscode.QuickPickItem {
  row: StepRow;
}

const MOVE_UP = 'Move up';
const REMOVE = 'Remove';

/** A row's button; made when drawn, since the page tests load this without VS Code. */
function button(icon: string, tooltip: string): vscode.QuickInputButton {
  return { iconPath: new vscode.ThemeIcon(icon), tooltip };
}

export const STEP_PLACEHOLDER = 'Type a step and press Enter. Add as many as you need.';
export const SUGGESTED_PLACEHOLDER = 'Remove any you do not want, then choose Write.';

/**
 * The list's state, apart from the quick pick that shows it, so what each
 * key and choice does can be tested without one.
 */
export class StepList {
  public readonly steps: NewStep[] = [];
  /** The new step being changed, while its words are in the box. */
  public editing: number | undefined;

  public constructor(
    public readonly written: readonly WrittenStep[],
    /** The model's name, when Suggest steps is offered. */
    public readonly model?: { label: string; vendor?: string },
    private readonly title: string = '',
  ) {}

  /** The rows for what is typed now, top to bottom. */
  public items(value: string): StepItem[] {
    const typed = splitTypedSteps(value).join(' ');
    const items: StepItem[] = [];
    if (typed) {
      items.push(
        this.editing !== undefined
          ? {
              label: `$(edit) Change step ${this.editing + 1} to "${typed}"`,
              row: { kind: 'change', index: this.editing },
              alwaysShow: true,
            }
          : { label: `$(add) Add "${typed}"`, row: { kind: 'add' }, alwaysShow: true },
      );
    }
    if (this.written.length > 0) {
      items.push(separator('Already written'));
      this.written.forEach((step) =>
        items.push({
          label: `${step.done ? '$(pass-filled)' : '$(circle-large-outline)'} ${step.title}`,
          description: 'written',
          row: { kind: 'written' },
          alwaysShow: true,
        }),
      );
    }
    if (this.steps.length > 0) {
      items.push(separator('New steps'));
      this.steps.forEach((step, index) =>
        items.push({
          label: `${index + 1}. ${step.text}`,
          ...(step.suggested ? { description: 'suggested' } : {}),
          buttons: index > 0
            ? [button('arrow-up', MOVE_UP), button('trash', REMOVE)]
            : [button('trash', REMOVE)],
          row: { kind: 'new', index },
          alwaysShow: true,
        }),
      );
      items.push({
        label: `$(check) Write ${countSteps(this.steps.length)}`,
        description: 'under the task, as - [ ] lines',
        row: { kind: 'write' },
        alwaysShow: true,
      });
    }
    if (this.model) {
      items.push({
        label: '$(sparkle) Suggest steps',
        description: `asks ${this.model.vendor ? `${this.model.vendor} · ` : ''}${this.model.label}`,
        detail: `Sends only this task's words, ${quoteTitle(this.title)}. Nothing is written until you choose Write.`,
        row: { kind: 'suggest' },
        alwaysShow: true,
      });
    }
    return items;
  }

  /** Adds what was typed, or changes the step being edited. */
  public take(value: string): void {
    const typed = splitTypedSteps(value);
    if (typed.length === 0) {
      return;
    }
    if (this.editing !== undefined) {
      this.steps[this.editing] = { text: typed.join(' '), suggested: false };
      this.editing = undefined;
      return;
    }
    // A pasted list that kept its line breaks is several steps.
    typed.forEach((text) => this.steps.push({ text, suggested: false }));
  }

  /** Adds a model's steps below what is there. */
  public suggestSteps(texts: readonly string[]): void {
    texts.forEach((text) => this.steps.push({ text, suggested: true }));
  }

  /** Swaps a new step with the one above it. */
  public moveUp(index: number): void {
    if (index > 0 && index < this.steps.length) {
      [this.steps[index - 1], this.steps[index]] = [this.steps[index], this.steps[index - 1]];
      this.editing = undefined;
    }
  }

  public remove(index: number): void {
    this.steps.splice(index, 1);
    this.editing = undefined;
  }

  /** The row Enter picks on an empty box: Write, once there is something to write. */
  public defaultRow(items: readonly StepItem[], value: string): StepItem | undefined {
    if (value.trim() === '') {
      return items.find((item) => item.row.kind === 'write');
    }
    return items.find((item) => item.row.kind === 'add' || item.row.kind === 'change');
  }
}

function separator(label: string): StepItem {
  return { label, kind: vscode.QuickPickItemKind.Separator, row: { kind: 'separator' } };
}

function countSteps(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

/** The steps already written under a task line, read from the note. */
export function readWrittenSteps(lines: readonly string[], lineIndex: number): WrittenStep[] {
  return findStepFamily(lines, lineIndex).steps.map((line) => {
    const text = lines[line];
    const column = findCheckboxColumn(text);
    const words = text.slice(column + 2).trim();
    return {
      title: parseTaskMetadata(words).title || words,
      done: isCheckedTaskLine(text),
    };
  });
}

/**
 * Asks for the steps: the list, until Write or Escape. Returns the steps to
 * write, or undefined when nothing should be.
 */
export async function pickSteps(
  target: StepTarget,
  written: readonly WrittenStep[],
  suggester?: StepSuggester,
): Promise<string[] | undefined> {
  const model = await suggester?.model().catch(() => undefined);
  const list = new StepList(written, model, target.title);
  const pick = vscode.window.createQuickPick<StepItem>();
  pick.title =
    written.length > 0
      ? `Add steps to ${quoteTitle(target.title)}`
      : `Break ${quoteTitle(target.title)} into steps`;
  pick.placeholder = STEP_PLACEHOLDER;
  pick.ignoreFocusOut = true;
  pick.matchOnDescription = false;
  pick.matchOnDetail = false;
  let request: vscode.CancellationTokenSource | undefined;

  const redraw = (): void => {
    const items = list.items(pick.value);
    pick.items = items;
    const chosen = list.defaultRow(items, pick.value);
    pick.activeItems = chosen ? [chosen] : [];
  };

  return new Promise<string[] | undefined>((resolve) => {
    let settled = false;
    const finish = (steps: string[] | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      request?.cancel();
      resolve(steps);
      pick.hide();
    };
    const suggest = async (): Promise<void> => {
      if (!suggester || !model) {
        return;
      }
      request = new vscode.CancellationTokenSource();
      pick.busy = true;
      pick.enabled = false;
      pick.placeholder = `Asking ${model.label} for steps…`;
      try {
        const steps = await suggester.suggest(target.title, request.token);
        if (settled) {
          return;
        }
        if (steps.length === 0) {
          void vscode.window.showWarningMessage(`${model.label} suggested no steps. Type them instead.`);
          pick.placeholder = STEP_PLACEHOLDER;
        } else {
          list.suggestSteps(steps);
          pick.placeholder = SUGGESTED_PLACEHOLDER;
        }
      } catch (error) {
        if (!settled) {
          void vscode.window.showWarningMessage(describeSuggestFailure(model.label, error));
          pick.placeholder = STEP_PLACEHOLDER;
        }
      } finally {
        request = undefined;
        pick.busy = false;
        pick.enabled = true;
        if (!settled) {
          redraw();
        }
      }
    };

    pick.onDidChangeValue(redraw);
    pick.onDidAccept(() => {
      const [item] = pick.selectedItems.length > 0 ? pick.selectedItems : pick.activeItems;
      const row = item?.row ?? (pick.value.trim() ? { kind: 'add' as const } : undefined);
      switch (row?.kind) {
        case 'add':
        case 'change':
          list.take(pick.value);
          pick.value = '';
          redraw();
          return;
        case 'new':
          list.editing = row.index;
          pick.value = list.steps[row.index].text;
          redraw();
          return;
        case 'write':
          finish(list.steps.map((step) => step.text));
          return;
        case 'suggest':
          void suggest();
          return;
        default:
          return;
      }
    });
    pick.onDidTriggerItemButton(({ item, button }) => {
      if (item.row.kind !== 'new') {
        return;
      }
      if (button.tooltip === MOVE_UP) {
        list.moveUp(item.row.index);
      } else if (button.tooltip === REMOVE) {
        list.remove(item.row.index);
      }
      redraw();
    });
    pick.onDidHide(() => {
      finish(undefined);
      pick.dispose();
    });
    redraw();
    pick.show();
  });
}

/** The one message Suggest steps sends: the task's words, and nothing else. */
export function buildSuggestPrompt(title: string): string {
  return [
    'Break this task into small, concrete steps one person can do one at a time, in order. Reply with 3 to 7 steps, one per line, each under 80 characters, with no numbering, bullets, or other text.',
    '',
    `Task: ${title}`,
  ].join('\n');
}

/** What VS Code's consent dialog says Deckard wants a model for. */
export const SUGGEST_JUSTIFICATION = 'Deckard sends the words of the task you chose, to suggest steps for it.';

/** How long a suggestion may take before it is given up on. */
const SUGGEST_TIMEOUT_MS = 30_000;

/** A vendor's name as people know it. */
function vendorName(vendor: string): string {
  return vendor === 'copilot' ? 'GitHub Copilot' : vendor;
}

/**
 * Suggest steps through VS Code's Language Model API. Nothing is sent to
 * find a model: `selectChatModels` lists the ones installed. A request is
 * made only when Suggest steps is chosen, and carries the task's words alone.
 */
export function createLanguageModelSuggester(): StepSuggester {
  let chosen: vscode.LanguageModelChat | undefined;
  return {
    async model() {
      chosen = undefined;
      const enabled = vscode.workspace
        .getConfiguration('deckard')
        .get<boolean>('tasks.suggestSteps', true);
      if (!enabled || !vscode.lm?.selectChatModels) {
        return undefined;
      }
      const models = await vscode.lm.selectChatModels();
      chosen = models.find((model) => model.vendor === 'copilot') ?? models[0];
      return chosen ? { label: chosen.name, vendor: vendorName(chosen.vendor) } : undefined;
    },
    async suggest(title, token) {
      const model = chosen;
      if (!model) {
        throw new Error('no model is installed');
      }
      const source = new vscode.CancellationTokenSource();
      const cancelled = token.onCancellationRequested(() => source.cancel());
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        source.cancel();
      }, SUGGEST_TIMEOUT_MS);
      try {
        return await measureAsync(`Suggest steps with ${model.name}`, async () => {
          const response = await model.sendRequest(
            [vscode.LanguageModelChatMessage.User(buildSuggestPrompt(title))],
            { justification: SUGGEST_JUSTIFICATION },
            source.token,
          );
          let reply = '';
          for await (const part of response.text) {
            reply += part;
          }
          return parseSuggestedSteps(reply);
        });
      } catch (error) {
        reportError(`Suggest steps with ${model.name} failed`, error);
        throw timedOut ? new Error('it took longer than 30 seconds') : error;
      } finally {
        clearTimeout(timer);
        cancelled.dispose();
        source.dispose();
      }
    },
  };
}

/** Why Suggest steps gave nothing, in words to show beside the list. */
export function describeSuggestFailure(model: string, error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === 'NoPermissions') {
    return `Deckard was not allowed to use ${model}, so it suggested nothing. Type the steps instead.`;
  }
  const reason = error instanceof Error && error.message ? error.message : 'no reply';
  return `${model} could not suggest steps (${reason}). Type the steps instead.`;
}

/**
 * Writes steps under a task, after whatever is under it already, in one
 * change: said with an Undo, and taken back by Undo Last Change too.
 */
export async function addTaskSteps(
  target: StepTarget,
  steps: readonly string[],
): Promise<boolean> {
  if (steps.length === 0) {
    return false;
  }
  const uri = await resolveSourceUri(target.filePath);
  if (!uri) {
    void reportFailure({
      outcome: `Deckard could not find ${target.filePath}, so nothing was written.`,
      fix: 'It may have been moved or deleted since Deckard last read it.',
      action: reindexAction(),
    });
    return false;
  }
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    if (!readIndexedTaskLine(document, target)) {
      void reportStale([uri]);
      return false;
    }
    const lines = document.getText().split(/\r?\n/);
    const plan = planStepInsertion(lines, target.lineNumber - 1);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const written = formatStepLines(steps, plan.indent, plan.marker);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, document.lineAt(plan.afterLine).range.end, eol + written.join(eol));
    const quoted = quoteTitle(target.title);
    const result = await applyWorkspaceWrite(edit, {
      label: `writing ${countSteps(steps.length)} under ${quoted}`,
    });
    if (!result.applied) {
      void reportFailure(describeRejectedEdit(noteName(uri)));
      return false;
    }
    const mine = workspaceWrites.lastWrite;
    void vscode.window
      .showInformationMessage(`Wrote ${countSteps(steps.length)} under ${quoted}.`, 'Undo')
      .then(async (choice) => {
        if (choice !== 'Undo') {
          return;
        }
        if (workspaceWrites.lastWrite !== mine) {
          void vscode.window.showInformationMessage(
            'Deckard has changed your notes again since, so use Deckard: Undo Last Change.',
          );
          return;
        }
        reportUndo(await workspaceWrites.undo(), `Took the ${countSteps(steps.length)} back out.`);
      });
    return true;
  } catch (error) {
    void reportFailure({
      outcome: `Deckard could not write the steps in ${noteName(uri)}, so nothing was written.`,
      error,
    });
    return false;
  }
}

/** A task with words after its box, which is what can be broken into steps. */
const CURSOR_TASK: TaskLineShape = { indent: 'spaces-and-tabs', marks: ' xX', after: 'gap-then-words' };

/**
 * The task on the cursor's line, read from the editor itself, so a task
 * typed a moment ago can be broken into steps before the index has it.
 */
function readCursorTask(indexer: WorkspaceIndexer): { target: StepTarget; lines: string[] } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    return undefined;
  }
  const lineIndex = editor.selection.active.line;
  const lines = editor.document.getText().split(/\r?\n/);
  const text = lines[lineIndex] ?? '';
  const column = findCheckboxColumn(text);
  if (column < 0 || !isTaskLineOf(text, CURSOR_TASK)) {
    return undefined;
  }
  const words = text.slice(column + 2).trim();
  return {
    lines,
    target: {
      filePath: indexer.getFilePath(editor.document.uri),
      lineNumber: lineIndex + 1,
      sourceLineText: text,
      checkboxColumn: column,
      checkboxValue: text[column] as ' ' | 'x' | 'X',
      title: parseTaskMetadata(words).title || words,
    },
  };
}

/**
 * Deckard: Break into Steps… — for a task from the Tasks view or the board,
 * or the task on the cursor's line.
 */
export async function breakIntoStepsCommand(
  indexer: WorkspaceIndexer,
  task?: Task,
  suggester: StepSuggester | undefined = createLanguageModelSuggester(),
): Promise<boolean> {
  let target: StepTarget;
  let lines: string[];
  if (task) {
    const uri = await resolveSourceUri(task.filePath);
    if (!uri) {
      void reportFailure({
        outcome: `Deckard could not find ${task.filePath}, so nothing was written.`,
        fix: 'It may have been moved or deleted since Deckard last read it.',
        action: reindexAction(),
      });
      return false;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    if (!readIndexedTaskLine(document, task)) {
      void reportStale([uri]);
      return false;
    }
    target = task;
    lines = document.getText().split(/\r?\n/);
  } else {
    const read = readCursorTask(indexer);
    if (!read) {
      void vscode.window.showInformationMessage('Put the cursor on a task to break it into steps.');
      return false;
    }
    ({ target, lines } = read);
  }
  const steps = await pickSteps(target, readWrittenSteps(lines, target.lineNumber - 1), suggester);
  if (!steps || steps.length === 0) {
    return false;
  }
  return addTaskSteps(target, steps);
}
