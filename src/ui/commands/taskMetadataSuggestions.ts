import * as vscode from 'vscode';

import { findFencedLines } from '../../core/markdown/parser';
import {
  addDays,
  formatIsoDate,
  formatTaskMetadata,
  parseTaskMetadata,
  startOfDay,
  TaskMetadataField,
  TaskMetadataFormat,
} from '../../core/markdown/taskMetadata';
import { WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { readTaskMetadataFormat } from './taskActions';

interface TaskIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

export interface TaskMetadataSuggestionSettings {
  enabled: boolean;
  /** Format for a task that has no metadata yet. */
  format: TaskMetadataFormat;
}

/** A task's checkbox, which metadata must follow. */
const TASK_CHECKBOX = /^\s*[-*+][ \t]+\[[ xX]\](?=[ \t])/;
/** A `/` that starts a word, and whatever has been typed after it. */
const SLASH_QUERY = /(?:^|[ \t])\/([A-Za-z-]*)$/;

const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];
const REPEAT_RULES = [
  'every day',
  'every weekday',
  'every week',
  'every month',
  'every year',
];

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
  private readonly registration: vscode.Disposable;

  public constructor(
    private readonly indexer: TaskIndexSource,
    private readonly readSettings: (
      document: vscode.TextDocument,
    ) => TaskMetadataSuggestionSettings = readTaskMetadataSuggestionSettings,
    private readonly now: () => number = Date.now,
  ) {
    this.registration = vscode.languages.registerCompletionItemProvider(
      { pattern: '**/*.md' },
      {
        provideCompletionItems: (document, position) =>
          this.provideCompletionItems(document, position),
      },
      '/',
    );
  }

  public dispose(): void {
    this.registration.dispose();
  }

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const settings = this.readSettings(document);
    if (!settings.enabled || !isMarkdownFile(document.uri)) {
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
    await this.indexer.ready;
    return createSuggestions(this.now(), this.indexer.getSnapshot()).map(
      (suggestion, index) => toCompletionItem(suggestion, format, range, index),
    );
  }
}

export function readTaskMetadataSuggestionSettings(
  document: vscode.TextDocument,
): TaskMetadataSuggestionSettings {
  const configuration = vscode.workspace.getConfiguration(
    'deckard',
    document.uri,
  );
  return {
    enabled: configuration.get<boolean>('tasks.metadataSuggestions', true),
    format: readTaskMetadataFormat(configuration),
  };
}

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

/**
 * Lists the ids of open tasks, which are the ones worth depending on.
 */
function collectOpenTaskIds(
  index: WorkspaceIndex,
): Array<{ id: string; title: string }> {
  const ids = new Map<string, string>();
  for (const task of index.tasks.values()) {
    if (!task.completed && task.dependencyId && !ids.has(task.dependencyId)) {
      ids.set(task.dependencyId, task.title);
    }
  }
  return [...ids]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, title]) => ({ id, title }));
}

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
