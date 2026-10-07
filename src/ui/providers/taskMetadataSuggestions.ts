import * as vscode from 'vscode';

import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { isPersonTag } from '../../domain/markdown/parser';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { readTaskMetadataFormat } from '../commands/taskActions';
import { whenPublished } from '../../core/workspace/publishing';
import { WorkspaceIndex } from '../../domain/model';
import { formatTaskMetadata, parseTaskMetadata, TaskMetadataField, TaskMetadataFormat } from '../../domain/markdown/taskFields';
import { addDays, formatIsoDate, startOfDay } from '../../domain/markdown/calendar';
import { findFencedLines, STATUS_CHARACTER } from '../../domain/markdown/lineShapes';

/** What the suggestions read from the indexer: the people and task ids to offer. */
interface TaskIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  /** Whether a file is one of the notes, not a README in a code folder. */
  isNotesFile?(uri: vscode.Uri): boolean;
}

/** The setting the suggestions answer to, for one note. */
export interface TaskMetadataSuggestionSettings {
  /** Format for a task that has no metadata yet. */
  format: TaskMetadataFormat;
}

/** A task's checkbox, which metadata must follow. */
const TASK_CHECKBOX = new RegExp(String.raw`^\s*[-*+][ \t]+\[${STATUS_CHARACTER}\](?=[ \t])`);
/** A `/` that starts a word, and whatever has been typed after it. */
const SLASH_QUERY = /(?:^|[ \t])\/([A-Za-z-]*)$/;

/** The priorities offered, highest first. */
const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];
/** How many people the list offers before it becomes a list of everyone. */
const PERSON_SUGGESTION_LIMIT = 8;
/** The repeat rules offered as written; any other is typed into a placeholder. */
const REPEAT_RULES = [
  'every day',
  'every weekday',
  'every week',
  'every month',
  'every year',
];

/** One field to add, and the value written for it. */
interface MetadataSuggestion {
  label: string;
  field: TaskMetadataField;
  value: string;
  /** True when `value` holds a `${1:…}` placeholder the author fills in. */
  snippet?: boolean;
  detail?: string;
}

/**
 * Suggests Obsidian Tasks metadata after `/` in a task, so a due date,
 * priority, or repeat rule can be added without typing emoji or remembering
 * Dataview keys.
 *
 * `/` is the trigger because Markdown files do not show suggestions as you
 * type by default, and no Markdown or tag syntax starts a word with it.
 * Suggestions use the format the task already uses, or the configured one for
 * a task without metadata.
 */
export class TaskMetadataCompletionProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];

  /**
   * Takes the index people and task ids are offered from, the settings
   * reader, and the clock the dates are counted from; nothing is registered
   * until `register`.
   */
  public constructor(
    private readonly indexer: TaskIndexSource,
    private readonly readSettings: (
      document: vscode.TextDocument,
    ) => TaskMetadataSuggestionSettings = readTaskMetadataSuggestionSettings,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Registers the suggestions for Markdown files, after `/`. Returns the
   * provider, so the composition root can build and register it in one
   * expression.
   */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCompletionItemProvider(
        { pattern: '**/*.md' },
        {
          provideCompletionItems: (document, position) =>
            this.provideCompletionItems(document, position),
        },
        '/',
      ),
    );
    return this;
  }

  /** Unregisters the suggestions. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * The metadata a task can take, after a `/` that starts a word past the
   * task's checkbox, in the format the task already uses; nothing in fenced
   * code or outside the notes.
   */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const settings = this.readSettings(document);
    if (!isMarkdownFile(document.uri) || !(this.indexer.isNotesFile?.(document.uri) ?? true)) {
      return [];
    }

    const line = document.lineAt(position.line).text;
    const checkbox = TASK_CHECKBOX.exec(line);
    const query = SLASH_QUERY.exec(line.slice(0, position.character));
    if (!checkbox || !query || position.character <= checkbox[0].length) {
      return [];
    }
    if (findFencedLines(document.getText().split(/\r?\n/)).has(position.line)) {
      return [];
    }

    const format =
      parseTaskMetadata(line.slice(checkbox[0].length)).format ??
      settings.format;
    const range = new vscode.Range(
      position.line,
      position.character - query[1].length - 1,
      position.line,
      position.character,
    );
    await whenPublished(this.indexer);
    return createSuggestions(this.now(), this.indexer.getSnapshot()).map(
      (suggestion, index) => toCompletionItem(suggestion, format, range, index),
    );
  }
}

/**
 * Reads the metadata format for a note, scoped to it so a folder's own
 * settings apply.
 */
export function readTaskMetadataSuggestionSettings(
  document: vscode.TextDocument,
): TaskMetadataSuggestionSettings {
  const configuration = vscode.workspace.getConfiguration(
    'deckard',
    document.uri,
  );
  return { format: readTaskMetadataFormat(configuration) };
}

/**
 * Every field that can be added, in the order offered: dates as of the day
 * `now` falls on, priorities, repeat rules, the people the workspace names
 * most, and the ids of open tasks to depend on. A field with a placeholder
 * lets the author write any other value.
 */
function createSuggestions(
  now: number,
  index: WorkspaceIndex,
): MetadataSuggestion[] {
  const today = startOfDay(now);
  const day = (offset: number): string => formatIsoDate(addDays(today, offset));
  const onDate = (
    label: string,
    field: TaskMetadataField,
  ): MetadataSuggestion => ({
    label,
    field,
    value: `\${1:${day(0)}}`,
    snippet: true,
  });

  return [
    { label: 'due today', field: 'due', value: day(0) },
    { label: 'due tomorrow', field: 'due', value: day(1) },
    { label: 'due in a week', field: 'due', value: day(7) },
    onDate('due on a date', 'due'),
    { label: 'scheduled today', field: 'scheduled', value: day(0) },
    { label: 'scheduled tomorrow', field: 'scheduled', value: day(1) },
    onDate('scheduled on a date', 'scheduled'),
    { label: 'starts tomorrow', field: 'start', value: day(1) },
    onDate('starts on a date', 'start'),
    ...PRIORITIES.map(
      (priority): MetadataSuggestion => ({
        label: `${priority} priority`,
        field: 'priority',
        value: priority,
      }),
    ),
    ...REPEAT_RULES.map(
      (rule): MetadataSuggestion => ({
        label: `repeats ${rule}`,
        field: 'repeat',
        value: rule,
      }),
    ),
    {
      label: 'repeats on a rule',
      field: 'repeat',
      value: '${1:every 2 weeks}',
      snippet: true,
    },
    ...collectPeople(index).map(
      ({ key, label }): MetadataSuggestion => ({
        label: `for ${label}`,
        field: 'assignee',
        value: key,
      }),
    ),
    {
      label: 'for a person',
      field: 'assignee',
      value: '${1:@name}',
      snippet: true,
    },
    { label: 'task id', field: 'id', value: '${1:id}', snippet: true },
    ...collectOpenTaskIds(index).map(
      ({ id, title }): MetadataSuggestion => ({
        label: `depends on ${id}`,
        field: 'dependsOn',
        value: id,
        detail: title,
      }),
    ),
  ];
}

/** The people the workspace writes about most, to hand a task to. */
function collectPeople(
  index: WorkspaceIndex,
): Array<{ key: string; label: string }> {
  return [...index.tags.values()]
    .filter((tag) => isPersonTag(tag.key))
    .sort((left, right) => right.count - left.count)
    .slice(0, PERSON_SUGGESTION_LIMIT)
    .map((tag) => ({ key: tag.label, label: tag.label }));
}

/**
 * Lists the ids of open tasks, which are the ones worth depending on.
 */
function collectOpenTaskIds(
  index: WorkspaceIndex,
): Array<{ id: string; title: string }> {
  const ids = new Map<string, string>();
  for (const task of index.tasks.values()) {
    if (isOpenTask(task) && task.dependencyId && !ids.has(task.dependencyId)) {
      ids.set(task.dependencyId, task.title);
    }
  }
  return [...ids]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, title]) => ({ id, title }));
}

/**
 * A suggestion as the completion that writes it in the note's format,
 * replacing the `/query` typed, and kept at its place in the list.
 */
function toCompletionItem(
  suggestion: MetadataSuggestion,
  format: TaskMetadataFormat,
  range: vscode.Range,
  index: number,
): vscode.CompletionItem {
  const text = formatTaskMetadata(suggestion.field, suggestion.value, format);
  const item = new vscode.CompletionItem(
    {
      label: suggestion.label,
      // Shows what will be written, with a placeholder shown as its default.
      description: text.replace(/\$\{1:([^}]*)\}/, '$1'),
    },
    vscode.CompletionItemKind.Property,
  );
  item.insertText = suggestion.snippet ? new vscode.SnippetString(text) : text;
  item.filterText = `/${suggestion.label}`;
  item.detail = suggestion.detail;
  item.range = range;
  item.sortText = String(index).padStart(3, '0');
  return item;
}
