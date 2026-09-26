import * as vscode from 'vscode';

import { getTaskLineId } from '../../core/markdown/parser';
import {
  formatIsoDate,
  parseTaskMetadata,
  setTaskLineCompletion,
  TaskMetadataFormat,
  writeCompletion,
} from '../../core/markdown/taskMetadata';
import { readStepsForNextOccurrence } from '../../core/markdown/taskSteps';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { describeRejectedEdit, noteName, reportFailure } from './notify';
import {
  carryTaskRank,
  describeCompletion,
  quoteTitle,
  readTaskMetadataFormat,
} from './taskActions';

/** The checkbox a line must open with to be toggled. */
const TASK_LINE = /^(\s*[-*+][ \t]+\[)([ xX])\]/;

/** One task line under a cursor, as it is and as it will be written. */
export interface ToggledLine {
  /** Zero-based. */
  line: number;
  before: string;
  after: string;
  title: string;
  next?: string;
  unreadRule?: string;
}

/** What one toggle wrote, and what it says about it. */
export interface ToggleResult {
  completed: boolean;
  lines: ToggledLine[];
}

/**
 * The lines a set of selections touches, each once, top to bottom. A
 * selection that ends at the very start of a line does not take that line,
 * the way Toggle Line Comment reads it.
 */
export function selectedLines(
  selections: readonly { start: { line: number; character: number }; end: { line: number; character: number } }[],
): number[] {
  const lines = new Set<number>();
  for (const selection of selections) {
    const last =
      selection.end.line > selection.start.line && selection.end.character === 0
        ? selection.end.line - 1
        : selection.end.line;
    for (let line = selection.start.line; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Completes or reopens the task lines given, the way Toggle Line Comment
 * decides: if any of them is open, every open one is completed; otherwise
 * every one is reopened. A completion writes its done date and, for a
 * repeating task, its next occurrence on the line above, through the same
 * path as every other completion.
 */
export function toggleTaskLines(
  lines: readonly { line: number; text: string }[],
  now: number,
  options: {
    addDoneDate: boolean;
    format: TaskMetadataFormat;
    eol: string;
    /** The whole note, so a repeating task's next occurrence takes its steps. */
    documentLines?: readonly string[];
  },
): ToggleResult {
  const tasks = lines
    .map((entry) => ({ ...entry, match: TASK_LINE.exec(entry.text) }))
    .filter((entry): entry is typeof entry & { match: RegExpExecArray } => entry.match !== null);
  const completed = tasks.some((entry) => entry.match[2] === ' ');
  const toggled: ToggledLine[] = [];
  for (const { line, text, match } of tasks) {
    const open = match[2] === ' ';
    if (completed !== open) {
      continue;
    }
    const checkboxColumn = match[1].length;
    const marked = setTaskLineCompletion(
      text,
      checkboxColumn,
      completed,
      options.addDoneDate ? formatIsoDate(now) : undefined,
      options.format,
    );
    const title = parseTaskMetadata(text.slice(checkboxColumn + 2)).title;
    if (!completed) {
      toggled.push({ line, before: text, after: marked, title });
      continue;
    }
    const completion = writeCompletion(
      marked,
      checkboxColumn,
      now,
      options.eol,
      options.documentLines ? readStepsForNextOccurrence(options.documentLines, line) : [],
    );
    toggled.push({
      line,
      before: text,
      after: completion.text,
      title,
      ...(completion.next !== undefined ? { next: completion.next } : {}),
      ...(completion.unreadRule !== undefined ? { unreadRule: completion.unreadRule } : {}),
    });
  }
  return { completed, lines: toggled };
}

/** The sentence a toggle says in the status bar, or as a warning. */
export function describeToggle(result: ToggleResult): { text: string; severity: 'info' | 'warning' } {
  const [first] = result.lines;
  if (result.lines.length === 1) {
    return result.completed
      ? describeCompletion(first.title, first.next, first.unreadRule)
      : { text: `Reopened ${quoteTitle(first.title)}.`, severity: 'info' };
  }
  const count = result.lines.length;
  if (!result.completed) {
    return { text: `Reopened ${count} tasks.`, severity: 'info' };
  }
  const unread = result.lines.find((line) => line.unreadRule !== undefined);
  if (unread) {
    return {
      text: `Completed ${count} tasks. Deckard could not read the repeat rule "${unread.unreadRule}" of ${quoteTitle(unread.title)}, so no next one was added.`,
      severity: 'warning',
    };
  }
  const started = result.lines.filter((line) => line.next !== undefined).length;
  return {
    text:
      started > 0
        ? `Completed ${count} tasks, and started the next one of ${started === 1 ? '1 repeating task' : `${started} repeating tasks`}.`
        : `Completed ${count} tasks.`,
    severity: 'info',
  };
}

/** Where a task's rank is kept: the index's own path for the note. */
interface RankPaths {
  getFilePath(uri: vscode.Uri): string;
}

/**
 * Completes or reopens every task under the editor's cursors in one edit, so
 * one Undo takes it all back. It writes into the buffer rather than through
 * the index, so an unsaved note works like any other.
 */
export async function toggleTaskDoneCommand(
  paths?: RankPaths,
  now: number = Date.now(),
): Promise<ToggleResult | undefined> {
  const editor = vscode.window.activeTextEditor;
  // An untitled note set to Markdown is a note too; it has no file name yet.
  if (
    !editor ||
    !(isMarkdownFile(editor.document.uri) || editor.document.languageId === 'markdown')
  ) {
    void vscode.window.showInformationMessage('Put the cursor on a task to mark it done.');
    return undefined;
  }
  const document = editor.document;
  const configuration = vscode.workspace.getConfiguration('deckard', document.uri);
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const result = toggleTaskLines(
    selectedLines(editor.selections).map((line) => ({ line, text: document.lineAt(line).text })),
    now,
    {
      addDoneDate: configuration.get<boolean>('tasks.addDoneDate', true),
      format: readTaskMetadataFormat(configuration),
      eol,
      documentLines: document.getText().split(/\r?\n/),
    },
  );
  if (result.lines.length === 0) {
    void vscode.window.showInformationMessage('Put the cursor on a task to mark it done.');
    return undefined;
  }

  const applied = await editor.edit((builder) => {
    for (const toggled of [...result.lines].reverse()) {
      builder.replace(document.lineAt(toggled.line).range, toggled.after);
    }
  });
  if (!applied) {
    void reportFailure(describeRejectedEdit(noteName(document.uri)));
    return undefined;
  }

  // Each task keeps its place in the rank order. A next occurrence written
  // above a line moves every line below it down by one.
  if (paths && !document.isUntitled) {
    const filePath = paths.getFilePath(document.uri);
    let added = 0;
    for (const toggled of result.lines) {
      const lineNumber = toggled.line + 1;
      const previousId = getTaskLineId(filePath, lineNumber, toggled.before);
      if (previousId) {
        carryTaskRank(filePath, lineNumber + added, previousId, toggled.after);
      }
      added += toggled.after.split(/\r?\n/).length - 1;
    }
  }

  const said = describeToggle(result);
  if (said.severity === 'warning') {
    void vscode.window.showWarningMessage(said.text);
  } else {
    vscode.window.setStatusBarMessage(said.text, 5000);
  }
  return result;
}
