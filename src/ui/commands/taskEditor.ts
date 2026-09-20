import * as vscode from 'vscode';

import { extractTags } from '../../core/markdown/parser';
import {
  describeTaskDate,
  formatTaskDraft,
  isTaskLine,
  parseTaskDateInput,
  parseTaskDraft,
  TaskDraft,
} from '../../core/markdown/taskDraft';
import {
  formatIsoDate,
  parseRecurrence,
  TaskDateField,
} from '../../core/markdown/taskMetadata';
import { TaskPriority, WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { readTaskMetadataFormat } from './taskActions';

/**
 * Editing a whole task at once: its words, its dates, its priority, its
 * repeat rule, and what it waits for.
 *
 * Obsidian opens a dialog for this. VS Code has no dialog to open, and its
 * own multi-field flows — a launch configuration, a new file, a branch —
 * are all quick picks that step through their fields, so this is one too:
 * one pick listing every field with its value, each opening the input for
 * that field and coming back. The title of the pick is the line as it will
 * be written, so the Markdown is visible the whole way through.
 */

interface TaskEditorIndex {
  getSnapshot(): WorkspaceIndex;
}

/** A field of the editor, in the order the pick lists them. */
type DraftField =
  | 'description'
  | 'status'
  | 'due'
  | 'scheduled'
  | 'start'
  | 'priority'
  | 'recurrence'
  | 'dependsOn'
  | 'tag';

interface FieldRow extends vscode.QuickPickItem {
  field?: DraftField;
  done?: boolean;
}

const PRIORITIES: readonly { label: string; value?: TaskPriority }[] = [
  { label: 'Highest', value: 'highest' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'None' },
  { label: 'Low', value: 'low' },
  { label: 'Lowest', value: 'lowest' },
];

const REPEAT_RULES: readonly string[] = [
  'every day',
  'every weekday',
  'every week',
  'every 2 weeks',
  'every month',
  'every year',
];

/** The rows of the editor, as the pick shows them for a draft. */
export function createEditorRows(draft: TaskDraft): FieldRow[] {
  const value = (text: string | undefined, empty = 'Not set'): string =>
    text && text.trim() ? text : empty;
  return [
    {
      label: '$(pencil) Description',
      description: value(draft.description, 'Empty'),
      field: 'description',
    },
    {
      label: '$(check) Status',
      description: draft.completed ? 'Done' : 'Open',
      field: 'status',
    },
    { label: 'Dates', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(calendar) Due',
      description: value(draft.due && describeTaskDate(draft.due)),
      field: 'due',
    },
    {
      label: '$(watch) Scheduled',
      description: value(draft.scheduled && describeTaskDate(draft.scheduled)),
      field: 'scheduled',
    },
    {
      label: '$(rocket) Start',
      description: value(draft.start && describeTaskDate(draft.start)),
      field: 'start',
    },
    { label: 'And', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(arrow-up) Priority',
      description: value(draft.priority, 'None'),
      field: 'priority',
    },
    {
      label: '$(sync) Repeats',
      description: value(draft.recurrence, 'Never'),
      field: 'recurrence',
    },
    {
      label: '$(circle-slash) Blocked by',
      description: value(draft.dependsOn.join(', '), 'Nothing'),
      field: 'dependsOn',
    },
    {
      label: '$(tag) Add a tag',
      description: 'Written at the end of the description',
      field: 'tag',
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(save) Write the task',
      description: 'Enter',
      done: true,
    },
  ];
}

/**
 * Opens the editor on a line and returns the line it should become, or
 * nothing when the reader leaves without writing.
 *
 * The flow is a quick pick that stays open: choosing a field opens its own
 * input and returns here, so the task is built up in one place and nothing
 * is written until Write the task.
 */
export async function editTaskDraft(
  initial: TaskDraft,
  options: { title: string; index?: TaskEditorIndex; now?: number } = {
    title: 'Edit task',
  },
): Promise<TaskDraft | undefined> {
  let draft = initial;
  for (;;) {
    const chosen = await pickField(draft, options.title);
    if (!chosen) {
      return undefined;
    }
    if (chosen.done) {
      return draft;
    }
    const next = await readField(draft, chosen.field, options);
    if (next) {
      draft = next;
    }
  }
}

/** One turn of the editor: the fields, headed by the line so far. */
function pickField(
  draft: TaskDraft,
  title: string,
): Promise<FieldRow | undefined> {
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick<FieldRow>();
    pick.title = title;
    pick.placeholder = formatTaskDraft(draft).trim();
    pick.items = createEditorRows(draft);
    pick.ignoreFocusOut = true;
    let picked: FieldRow | undefined;
    pick.onDidAccept(() => {
      picked = pick.selectedItems[0];
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve(picked);
    });
    pick.show();
  });
}

/**
 * The draft a field's new value makes. These are what the editor actually
 * does to a task; the prompts around them only collect the words.
 */
export function completeDraft(draft: TaskDraft, now: number): TaskDraft {
  const completed = !draft.completed;
  // Completing here writes the done date a checkbox would have written, and
  // reopening takes it away again, so both agree with the rest of Deckard.
  return {
    ...draft,
    completed,
    ...(completed ? { done: draft.done ?? formatIsoDate(now) } : { done: undefined }),
  };
}

/** A date field's new value, or nothing when the words are not a day. */
export function setDraftDate(
  draft: TaskDraft,
  field: Extract<TaskDateField, 'due' | 'scheduled' | 'start'>,
  written: string,
  now: number,
): TaskDraft | undefined {
  const read = parseTaskDateInput(written, now);
  return read ? { ...draft, [field]: read.date } : undefined;
}

/** The ids a task waits for, as a comma-separated list is written. */
export function setDraftDependencies(
  draft: TaskDraft,
  written: string,
): TaskDraft {
  return {
    ...draft,
    dependsOn: written
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  };
}

/** Asks for one field's value and returns the draft it makes. */
async function readField(
  draft: TaskDraft,
  field: DraftField | undefined,
  options: { index?: TaskEditorIndex; now?: number },
): Promise<TaskDraft | undefined> {
  const now = options.now ?? Date.now();
  switch (field) {
    case 'description': {
      const written = await vscode.window.showInputBox({
        title: 'Description',
        prompt: 'What the task says. Tags written here stay in the line.',
        value: draft.description,
        ignoreFocusOut: true,
      });
      return written === undefined ? undefined : { ...draft, description: written.trim() };
    }
    case 'status':
      return completeDraft(draft, now);
    case 'due':
    case 'scheduled':
    case 'start':
      return readDate(draft, field, now);
    case 'priority': {
      const chosen = await vscode.window.showQuickPick(
        PRIORITIES.map((priority) => ({
          label: priority.label,
          picked: draft.priority === priority.value,
          value: priority.value,
        })),
        { title: 'Priority', placeHolder: 'How urgent is it?' },
      );
      return chosen === undefined
        ? undefined
        : { ...draft, priority: chosen.value };
    }
    case 'recurrence': {
      // The common rules to pick from, and room to write any other one.
      const written = await pickOrWrite({
        title: 'Repeats',
        placeholder:
          'Choose a rule, or write one such as "every month on the 15th"',
        items: [
          { label: 'Never', description: 'Happens once' },
          ...REPEAT_RULES.map((rule) => ({ label: rule })),
        ],
      });
      if (written === undefined) {
        return undefined;
      }
      const rule = written === 'Never' ? '' : written.trim();
      if (rule && !parseRecurrence(rule)) {
        void vscode.window.showWarningMessage(
          `Deckard cannot read "${rule}" as a repeat rule, so it would not write the next occurrence. The task keeps the rule it had.`,
        );
        return undefined;
      }
      return { ...draft, recurrence: rule || undefined };
    }
    case 'dependsOn': {
      const written = await vscode.window.showInputBox({
        title: 'Blocked by',
        prompt: 'The ids of the tasks that must be done first, separated by commas.',
        value: draft.dependsOn.join(', '),
        ignoreFocusOut: true,
      });
      return written === undefined
        ? undefined
        : setDraftDependencies(draft, written);
    }
    case 'tag':
      return addTag(draft, options.index);
    default:
      return undefined;
  }
}

/** Asks for a date, saying which day the words mean as they are typed. */
async function readDate(
  draft: TaskDraft,
  field: Extract<TaskDateField, 'due' | 'scheduled' | 'start'>,
  now: number,
): Promise<TaskDraft | undefined> {
  const written = await vscode.window.showInputBox({
    title: `${field[0].toUpperCase()}${field.slice(1)} date`,
    prompt:
      'A date such as 2026-09-25, today, tomorrow, friday, next monday, or in 3 days. Leave it empty to clear it.',
    value: draft[field] ?? '',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const read = parseTaskDateInput(value, now);
      if (!read) {
        return 'Deckard cannot read that as a day.';
      }
      // Saying the day back is the point of accepting words for one.
      return read.date
        ? {
            message: describeTaskDate(read.date),
            severity: vscode.InputBoxValidationSeverity.Info,
          }
        : undefined;
    },
  });
  return written === undefined
    ? undefined
    : setDraftDate(draft, field, written, now);
}

/** Offers the tags already in the workspace, and takes a new one as typed. */
async function addTag(
  draft: TaskDraft,
  index: TaskEditorIndex | undefined,
): Promise<TaskDraft | undefined> {
  const written = await pickOrWrite({
    title: 'Add a tag',
    placeholder: 'Choose a tag, or write a new one',
    items: index
      ? [...index.getSnapshot().tags.values()]
          .sort((left, right) => right.count - left.count)
          .slice(0, TAG_SUGGESTION_LIMIT)
          .map((tag) => ({
            label: tag.label,
            description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
          }))
      : [],
  });
  return written
    ? { ...draft, description: appendTag(draft.description, written.trim()) }
    : undefined;
}

/** How many of the workspace's tags the tag step offers. */
const TAG_SUGGESTION_LIMIT = 200;

/**
 * A pick whose list is a suggestion rather than the whole answer: Enter on a
 * row takes that row, and Enter on what was typed takes the typing.
 */
function pickOrWrite(options: {
  title: string;
  placeholder: string;
  items: vscode.QuickPickItem[];
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick();
    pick.title = options.title;
    pick.placeholder = options.placeholder;
    pick.items = options.items;
    pick.ignoreFocusOut = true;
    let value: string | undefined;
    pick.onDidAccept(() => {
      value = pick.selectedItems[0]?.label ?? pick.value.trim();
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve(value);
    });
    pick.show();
  });
}

/** Writes a tag at the end of the description, unless it is already there. */
export function appendTag(description: string, tag: string): string {
  const written = extractTags(tag);
  if (written.length !== 1 || written[0].label !== tag) {
    return description;
  }
  const carried = extractTags(description);
  return carried.some((candidate) => candidate.key === written[0].key)
    ? description
    : `${description.replace(/[ \t]+$/, '')} ${written[0].label}`.trim();
}

/**
 * Edits the task on the cursor's line, or makes one out of that line.
 *
 * The line is read when the editor opens and written when it closes, into
 * the document rather than through the index, so an unsaved note can be
 * edited like any other and nothing is written behind the reader's back.
 */
export async function editTaskCommand(
  index?: TaskEditorIndex,
  now: number = Date.now(),
): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownFile(editor.document.uri)) {
    void vscode.window.showInformationMessage(
      'Open a Markdown note to write a task.',
    );
    return undefined;
  }

  const line = editor.document.lineAt(editor.selection.active.line);
  const existing = isTaskLine(line.text);
  const draft = parseTaskDraft(
    line.text,
    readTaskMetadataFormat(
      vscode.workspace.getConfiguration('deckard', editor.document.uri),
    ),
  );
  const edited = await editTaskDraft(draft, {
    title: existing ? 'Edit task' : 'Add task',
    ...(index ? { index } : {}),
    now,
  });
  if (!edited) {
    return undefined;
  }

  const written = formatTaskDraft(edited);
  if (written === line.text) {
    return written;
  }
  const applied = await editor.edit((builder) =>
    builder.replace(line.range, written),
  );
  if (!applied) {
    void vscode.window.showErrorMessage(
      'Deckard could not write the task. VS Code rejected the edit.',
    );
    return undefined;
  }
  // The caret goes to the end of the description, where writing continues.
  const caret = new vscode.Position(
    line.lineNumber,
    Math.min(
      written.length,
      edited.prefix.length + edited.description.length,
    ),
  );
  editor.selection = new vscode.Selection(caret, caret);
  return written;
}

/** Whether the cursor is on a task line, which names the command. */
const ON_TASK_LINE = 'deckard.onTaskLine';

/**
 * Keeps `deckard.onTaskLine` in step with the cursor, so the palette offers
 * **Edit Task** on a task and **Add Task** anywhere else.
 *
 * Two commands rather than one word that is wrong half the time: a context
 * key and a `when` clause is how VS Code says which of two related commands
 * applies, and both run the same editor.
 */
export class TaskLineContext implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private onTaskLine: boolean | undefined;

  public constructor() {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        this.sync(editor),
      ),
      vscode.window.onDidChangeTextEditorSelection((event) =>
        this.sync(event.textEditor),
      ),
      // Typing `- [ ] ` turns the line the cursor is on into a task.
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.sync(vscode.window.activeTextEditor);
        }
      }),
    );
    this.sync(vscode.window.activeTextEditor);
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Reads the cursor's line, and tells VS Code only when the answer moves. */
  public sync(editor: vscode.TextEditor | undefined): void {
    const next =
      editor !== undefined &&
      isMarkdownFile(editor.document.uri) &&
      isTaskLine(editor.document.lineAt(editor.selection.active.line).text);
    if (next === this.onTaskLine) {
      return;
    }
    this.onTaskLine = next;
    void vscode.commands.executeCommand('setContext', ON_TASK_LINE, next);
  }
}

/**
 * Offers the editor on a task line, so it is found from the lightbulb as
 * well as from the palette.
 */
export class TaskEditorActions implements vscode.Disposable {
  private readonly registration: vscode.Disposable;

  public constructor() {
    this.registration = vscode.languages.registerCodeActionsProvider(
      { pattern: '**/*.md' },
      {
        provideCodeActions: (document, range) =>
          this.provideCodeActions(document, range),
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
    );
  }

  public dispose(): void {
    this.registration.dispose();
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const line = document.lineAt(range.start.line).text;
    if (!isMarkdownFile(document.uri) || !isTaskLine(line)) {
      return [];
    }
    const action = new vscode.CodeAction(
      'Edit task…',
      vscode.CodeActionKind.Refactor,
    );
    action.command = {
      command: 'deckard.editTask',
      title: 'Edit task…',
    };
    return [action];
  }
}
