import * as vscode from 'vscode';

import { createStatusPicks } from './taskEditor';
import { readTaskStatusOptions } from './parseSettings';
import {
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
  stripTags,
} from '../../domain/markdown/parser';
import {
  applyBulkEdit,
  BulkEdit,
  BulkEntry,
  reportBulkEditResult,
} from './bulkEdit';
import { askForDate } from './datePrompt';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { Section, Task } from '../../domain/model';

/**
 * Asking what to do to a search's results, and to which of them.
 *
 * The choosing is a VS Code quick pick rather than checkboxes drawn on the
 * page: every result is listed with its note and line, all picked to start
 * with, and unpicking one leaves it out. It is the list people already use to
 * choose many things at once, and it keeps the page a page.
 */

/** The edits a list of results can take. */
export function listBulkEdits(
  kind: 'notes' | 'tasks',
): Array<{ label: string; description: string; edit: BulkEdit | 'due' | 'tag' | 'status' }> {
  const tag = {
    label: 'Add a tag',
    description: 'Write one tag at the end of each line',
    edit: 'tag' as const,
  };
  if (kind === 'notes') {
    return [tag];
  }
  return [
    {
      label: 'Complete',
      description: 'Check each open task, with its done date and next occurrence',
      edit: { kind: 'complete', completed: true } as BulkEdit,
    },
    {
      label: 'Reopen',
      description: 'Uncheck each completed task',
      edit: { kind: 'complete', completed: false } as BulkEdit,
    },
    {
      label: 'Set a status',
      description: 'In progress, Waiting, Cancelled, or any other, on each task',
      edit: 'status' as const,
    },
    {
      label: 'Set a due date',
      description: 'Write, or clear, the 📅 date on each task',
      edit: 'due' as const,
    },
    tag,
  ];
}

/** How one result reads in the list of results to choose from. */
export function describeEntry(entry: BulkEntry): {
  label: string;
  description: string;
} {
  if (entry.kind === 'task') {
    const title = stripTags(entry.task.title).trim() || entry.task.title;
    return {
      label: `${entry.task.completed ? '[x]' : '[ ]'} ${title}`,
      description: `${fileName(entry.task.filePath)}:${entry.task.lineNumber}`,
    };
  }
  const heading = stripTags(entry.section.heading).trim() || entry.section.heading;
  return {
    label: heading,
    description: `${fileName(entry.section.filePath)}:${entry.section.startLine}`,
  };
}

/** The last segment of a workspace-relative path. */
function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/**
 * Asks what to do, to which results, and does it.
 *
 * Nothing is written until the reader has chosen an edit and the results to
 * make it to; after that the edit goes through the ordinary previewed,
 * undoable write.
 */
export async function editResults(
  history: WorkspaceWriteHistory,
  kind: 'notes' | 'tasks',
  results: { tasks: readonly Task[]; sections: readonly Section[] },
  uri?: vscode.Uri,
): Promise<void> {
  const entries: BulkEntry[] =
    kind === 'tasks'
      ? results.tasks.map((task) => ({ kind: 'task', task }))
      : results.sections.map((section) => ({ kind: 'section', section }));
  if (entries.length === 0) {
    void vscode.window.showInformationMessage(
      `This search found no ${kind === 'tasks' ? 'tasks' : 'notes'} to edit.`,
    );
    return;
  }

  const action = await vscode.window.showQuickPick(listBulkEdits(kind), {
    title: `Edit ${entries.length} ${
      kind === 'tasks' ? 'task' : 'note'
    }${entries.length === 1 ? '' : 's'} this search found`,
    placeHolder: 'Choose what to do to them',
  });
  if (!action) {
    return;
  }

  const edit = await readEdit(action.edit, uri);
  if (!edit) {
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    entries.map((entry) => ({ ...describeEntry(entry), entry, picked: true })),
    {
      canPickMany: true,
      title: 'Which results?',
      placeHolder: 'Every result is chosen; unpick any to leave it as it is',
    },
  );
  if (!chosen || chosen.length === 0) {
    return;
  }

  const result = await applyBulkEdit(
    history,
    chosen.map((item) => item.entry),
    edit,
  );
  if (result) {
    reportBulkEditResult(edit, result);
  }
}

/** Fills in an edit that still needs a value: a date, or a tag. */
async function readEdit(
  chosen: BulkEdit | 'due' | 'tag' | 'status',
  uri?: vscode.Uri,
): Promise<BulkEdit | undefined> {
  if (chosen === 'status') {
    const picked = await vscode.window.showQuickPick(createStatusPicks(readTaskStatusOptions(uri), ''), {
      title: 'Set a status',
      placeHolder: 'Choose the status every chosen task gets',
    });
    return picked ? { kind: 'status', status: picked.status } : undefined;
  }
  if (chosen === 'due') {
    const read = await askForDate({ title: 'Due date' });
    return read ? { kind: 'due', date: read.date } : undefined;
  }

  if (chosen === 'tag') {
    const configuration = vscode.workspace.getConfiguration('deckard', uri);
    const options = {
      entityNamespaceAliases: getEntityNamespaceAliases(
        configuration.get<unknown>('entityNamespaceAliases', {}),
      ),
      personMarker: getPersonMarker(
        configuration.get<unknown>('personMarker', '@'),
      ),
    };
    const written = await vscode.window.showInputBox({
      title: 'Add a tag',
      prompt: 'One tag, such as #project/atlas or @ren-kade, written at the end of each line.',
      validateInput: (value) => {
        const tags = extractTags(
          value.trim(),
          options.entityNamespaceAliases,
          options.personMarker,
        );
        return tags.length === 1 && tags[0].label === value.trim()
          ? undefined
          : 'Write exactly one tag, such as #project/atlas.';
      },
    });
    return written?.trim() ? { kind: 'tag', tag: written.trim() } : undefined;
  }

  return chosen;
}
