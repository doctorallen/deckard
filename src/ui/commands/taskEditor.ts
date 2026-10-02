import * as vscode from 'vscode';
import { describeRejectedEdit, noteName, reportFailure } from './notify';

import {
  extractTags,
  isPersonTag,
  readPerson,
} from '../../domain/markdown/parser';
import { DatePhraseOptions, nameDay, parseDatePhrase } from '../../domain/markdown/dates';
import {
  formatTaskDraft,
  isTaskLine,
  parseTaskDraft,
  TaskDraft,
} from '../../domain/markdown/taskDraft';
import { readStepsForNextOccurrence } from '../../domain/markdown/taskSteps';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { askForDate } from './datePrompt';
import { showQuickPickUntilHidden } from './prompts';
import { describeCompletion, readTaskMetadataFormat } from './taskActions';
import { TaskPriority, WorkspaceIndex } from '../../domain/model';
import { TaskDateField } from '../../domain/markdown/taskFields';
import { parseRecurrence, suggestRecurrence } from '../../domain/markdown/recurrence';
import { formatIsoDate } from '../../domain/markdown/calendar';
import { CompletionWrite, writeCompletion } from '../../domain/markdown/taskLineEdits';

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
  | 'assignee'
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
      description: value(draft.due && nameDay(draft.due)),
      field: 'due',
    },
    {
      label: '$(watch) Scheduled',
      description: value(draft.scheduled && nameDay(draft.scheduled)),
      field: 'scheduled',
    },
    {
      label: '$(rocket) Start',
      description: value(draft.start && nameDay(draft.start)),
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
      label: '$(person) Assignee',
      description: value(draft.assignee, 'Nobody named'),
      field: 'assignee',
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
  options: {
    title: string;
    index?: TaskEditorIndex;
    now?: number;
    /** `deckard.tasks.addDoneDate`: whether completing writes a ✅ date. */
    addDoneDate?: boolean;
  } = {
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
  return showQuickPickUntilHidden<FieldRow, FieldRow>({
    configure: (pick) => {
      pick.title = title;
      pick.placeholder = formatTaskDraft(draft).trim();
      pick.items = createEditorRows(draft);
      pick.ignoreFocusOut = true;
    },
    accept: (pick) => pick.selectedItems[0],
  });
}

/**
 * The draft a field's new value makes. These are what the editor actually
 * does to a task; the prompts around them only collect the words.
 */
export function completeDraft(
  draft: TaskDraft,
  now: number,
  /** `deckard.tasks.addDoneDate`; off, completing writes no ✅ date. */
  addDoneDate = true,
): TaskDraft {
  const completed = !draft.completed;
  // Completing here writes the done date a checkbox would have written, and
  // reopening takes it away again, so both agree with the rest of Deckard.
  return {
    ...draft,
    completed,
    ...(completed
      ? { done: draft.done ?? (addDoneDate ? formatIsoDate(now) : undefined) }
      : { done: undefined }),
  };
}

/** A task as it was and as edited, and how its lines are written. */
export interface EditedTaskWrite {
  before: TaskDraft;
  edited: TaskDraft;
  now: number;
  /** The note's line ending, which joins a repeat's next line. */
  eol: string;
  /** The steps the next occurrence of a repeating task takes, unchecked. */
  steps?: readonly string[];
}

/**
 * The lines an edited task is written as. Completing a repeating task starts
 * its next occurrence on the line above, as a checkbox does; reopening one,
 * or editing one already done, writes the one line.
 */
export function writeEditedTask({ before, edited, now, eol, steps = [] }: EditedTaskWrite): CompletionWrite {
  const line = formatTaskDraft(edited);
  if (before.completed || !edited.completed) {
    return { text: line };
  }
  return writeCompletion(line, line.search(/\[[xX]\]/) + 1, { now, eol, steps });
}

/** A draft, the date field to set on it, and the words written for it. */
export interface DraftDateChange {
  draft: TaskDraft;
  field: Extract<TaskDateField, 'due' | 'scheduled' | 'start'>;
  /** The words, such as `friday` or `in 2 days`, read against `now`. */
  written: string;
  now: number;
  /** How the words are read, such as the week's first day. */
  options?: DatePhraseOptions;
}

/** A date field's new value, or nothing when the words are not a day. */
export function setDraftDate({ draft, field, written, now, options = {} }: DraftDateChange): TaskDraft | undefined {
  const read = parseDatePhrase(written, now, options);
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

/** What a field's reader may need beyond the draft: the moment, the index, and a setting. */
interface FieldContext {
  index?: TaskEditorIndex;
  now: number;
  /** `deckard.tasks.addDoneDate`; completing writes a ✅ date unless it is false. */
  addDoneDate?: boolean;
}

/** Asks for one field's value and returns the draft it makes; undefined when the reader cancels. */
type FieldReader = (draft: TaskDraft, context: FieldContext) => Promise<TaskDraft | undefined>;

/** Asks for one field's value and returns the draft it makes. */
async function readField(
  draft: TaskDraft,
  field: DraftField | undefined,
  options: { index?: TaskEditorIndex; now?: number; addDoneDate?: boolean },
): Promise<TaskDraft | undefined> {
  const now = options.now ?? Date.now();
  if (field === undefined) {
    return undefined;
  }
  return FIELD_READERS[field](draft, { ...options, now });
}

/** The words of the task, as typed; tags written in them stay. */
async function readDescription(draft: TaskDraft): Promise<TaskDraft | undefined> {
  const written = await vscode.window.showInputBox({
    title: 'Description',
    prompt: 'What the task says. Tags written here stay in the line.',
    value: draft.description,
    ignoreFocusOut: true,
  });
  return written === undefined ? undefined : { ...draft, description: written.trim() };
}

/** One of the six priorities, the current one marked; None takes it off. */
async function readPriority(draft: TaskDraft): Promise<TaskDraft | undefined> {
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

/**
 * A repeat rule, picked or written; Never takes it off. A rule Deckard
 * cannot read is refused with a warning, since it would never write the
 * next occurrence, and the task keeps the rule it had.
 */
async function readRecurrence(draft: TaskDraft): Promise<TaskDraft | undefined> {
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
    const [nearest] = suggestRecurrence(rule);
    void vscode.window.showWarningMessage(
      `Deckard cannot read "${rule}" as a repeat rule, so it would not write the next occurrence. The task keeps the rule it had.${
        nearest ? ` Try "${nearest}".` : ''
      }`,
    );
    return undefined;
  }
  return { ...draft, recurrence: rule || undefined };
}

/** The ids of the tasks this one waits for, written as a comma-separated list. */
async function readDependencies(draft: TaskDraft): Promise<TaskDraft | undefined> {
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

/**
 * Who the task is for, picked from the people the workspace names or
 * written; Nobody takes the name off. A name that is not a person keeps the
 * person the task had, and says so.
 */
async function readAssignee(
  draft: TaskDraft,
  index: TaskEditorIndex | undefined,
): Promise<TaskDraft | undefined> {
  const chosen = await pickOrWrite({
    title: 'Who is it for?',
    placeholder: 'Choose a person, write one, or choose Nobody',
    items: [
      { label: 'Nobody', description: 'Take the name off the task' },
      ...people(index),
    ],
  });
  if (chosen === undefined) {
    return undefined;
  }
  if (chosen === 'Nobody') {
    return { ...draft, assignee: undefined };
  }
  const person = readPerson(chosen);
  if (!person) {
    void vscode.window.showWarningMessage(
      `Deckard cannot read "${chosen.trim()}" as a person. The task keeps the person it had.`,
    );
    return draft;
  }
  return { ...draft, assignee: person };
}

/** The reader for each field the pick lists. */
const FIELD_READERS: Readonly<Record<DraftField, FieldReader>> = {
  description: (draft) => readDescription(draft),
  // Status asks nothing: choosing it flips the task between open and done.
  status: (draft, { now, addDoneDate }) =>
    Promise.resolve(completeDraft(draft, now, addDoneDate ?? true)),
  due: (draft, { now }) => readDate(draft, 'due', now),
  scheduled: (draft, { now }) => readDate(draft, 'scheduled', now),
  start: (draft, { now }) => readDate(draft, 'start', now),
  priority: (draft) => readPriority(draft),
  recurrence: (draft) => readRecurrence(draft),
  assignee: (draft, { index }) => readAssignee(draft, index),
  dependsOn: (draft) => readDependencies(draft),
  tag: (draft, { index }) => addTag(draft, index),
};

/** Asks for a date, saying which day the words mean as they are typed. */
async function readDate(
  draft: TaskDraft,
  field: Extract<TaskDateField, 'due' | 'scheduled' | 'start'>,
  now: number,
): Promise<TaskDraft | undefined> {
  const read = await askForDate({
    title: `${field[0].toUpperCase()}${field.slice(1)} date`,
    value: draft[field] ?? '',
    now,
  });
  return read === undefined ? undefined : { ...draft, [field]: read.date };
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

/** The people the workspace already writes about, most used first. */
function people(index: TaskEditorIndex | undefined): vscode.QuickPickItem[] {
  return index
    ? [...index.getSnapshot().tags.values()]
        .filter((tag) => isPersonTag(tag.key))
        .sort((left, right) => right.count - left.count)
        .slice(0, TAG_SUGGESTION_LIMIT)
        .map((tag) => ({
          label: tag.label,
          description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
        }))
    : [];
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
  return showQuickPickUntilHidden<vscode.QuickPickItem, string>({
    configure: (pick) => {
      pick.title = options.title;
      pick.placeholder = options.placeholder;
      pick.items = options.items;
      pick.ignoreFocusOut = true;
    },
    accept: (pick) => pick.selectedItems[0]?.label ?? pick.value.trim(),
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
      'Open a note to write a task in it.',
    );
    return undefined;
  }

  const line = editor.document.lineAt(editor.selection.active.line);
  const existing = isTaskLine(line.text);
  const configuration = vscode.workspace.getConfiguration(
    'deckard',
    editor.document.uri,
  );
  const draft = parseTaskDraft(line.text, readTaskMetadataFormat(configuration));
  const edited = await editTaskDraft(draft, {
    title: existing ? 'Edit task' : 'Add task',
    ...(index ? { index } : {}),
    now,
    addDoneDate: configuration.get<boolean>('tasks.addDoneDate', true),
  });
  if (!edited) {
    return undefined;
  }

  const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const completion = writeEditedTask({
    before: draft,
    edited,
    now,
    eol,
    steps: existing
      ? readStepsForNextOccurrence(editor.document.getText().split(/\r?\n/), line.lineNumber)
      : [],
  });
  const written = completion.text;
  if (written === line.text) {
    return written;
  }
  // One edit writes the next occurrence and the completed line together, so
  // one undo takes both back.
  const applied = await editor.edit((builder) =>
    builder.replace(line.range, written),
  );
  if (!applied) {
    void reportFailure(describeRejectedEdit(noteName(editor.document.uri)));
    return undefined;
  }
  // The caret goes to the end of the description, where writing continues:
  // on the completed line, which a next occurrence pushed down by one.
  const caret = new vscode.Position(
    line.lineNumber + (completion.next === undefined ? 0 : 1),
    Math.min(
      formatTaskDraft(edited).length,
      edited.prefix.length + edited.description.length,
    ),
  );
  editor.selection = new vscode.Selection(caret, caret);
  if (completion.next !== undefined || completion.unreadRule !== undefined) {
    const said = describeCompletion(
      edited.description,
      completion.next,
      completion.unreadRule,
    );
    // The reader is looking at the line, and Cmd/Ctrl+Z undoes the edit, so
    // a next one started is said in passing; a rule that could not be read
    // is worth stopping for.
    if (said.severity === 'warning') {
      void vscode.window.showWarningMessage(said.text);
    } else {
      vscode.window.setStatusBarMessage(said.text, 5000);
    }
  }
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

  /** Follows the active editor, its cursor, and its edits, and sets the key for the editor already active. */
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

  /** Stops following; the context key keeps the value it last had. */
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

  /** Registers for every Markdown file at once; dispose takes the offer away. */
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

  /** Stops offering the editor from the lightbulb. */
  public dispose(): void {
    this.registration.dispose();
  }

  /**
   * Edit task… and Break into steps… on a task line of a Markdown note;
   * nothing on any other line.
   */
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
    const steps = new vscode.CodeAction(
      'Break into steps…',
      vscode.CodeActionKind.Refactor,
    );
    steps.command = {
      command: 'deckard.breakIntoSteps',
      title: 'Break into steps…',
    };
    return [action, steps];
  }
}
