import * as vscode from 'vscode';

import { Section, Task, WorkspaceIndex } from '../../core/types';

/**
 * A result set, taken out.
 *
 * Deckard reads the workspace and writes back into it; nothing leaves. A
 * search copied out as Markdown or CSV makes a result usable in a pull
 * request, an issue, or a message, while the index itself still never
 * leaves the machine. The whole result goes, not the page of it on screen.
 */

export type ExportFormat = 'markdown-list' | 'markdown-table' | 'csv';

export interface ExportChoice {
  format: ExportFormat;
  /** Copy to the clipboard, or save to a file the reader chooses. */
  to: 'clipboard' | 'file';
}

const FORMATS: { format: ExportFormat; label: string; detail: string; extension: string }[] = [
  { format: 'markdown-table', label: 'Markdown table', detail: 'One row per result, for a pull request or an issue', extension: 'md' },
  { format: 'markdown-list', label: 'Markdown list', detail: 'One line per result, with a link to it', extension: 'md' },
  { format: 'csv', label: 'CSV', detail: 'For a spreadsheet', extension: 'csv' },
];

/** One note as it goes out. */
export interface NoteRow {
  title: string;
  tags: string[];
  filePath: string;
  line: number;
  updatedAt?: number;
}

/** One task as it goes out. */
export interface TaskRow {
  completed: boolean;
  title: string;
  due: string;
  priority: string;
  assignee: string;
  tags: string[];
  filePath: string;
  heading: string;
  line: number;
}

export function noteRows(sections: readonly Section[]): NoteRow[] {
  return sections.map((section) => ({
    title: section.heading,
    tags: section.tags.map((key) => section.tagLabels[key] ?? key),
    filePath: section.filePath,
    line: section.startLine,
    updatedAt: section.updatedAt,
  }));
}

export function taskRows(tasks: readonly Task[], index: Pick<WorkspaceIndex, 'sections'>): TaskRow[] {
  return tasks.map((task) => ({
    completed: task.completed,
    title: task.title,
    due: task.dueText ?? (task.dueAt ? isoDate(task.dueAt) : ''),
    priority: task.priority ?? '',
    assignee: task.assignee ?? '',
    tags: task.tags.map((key) => task.tagLabels[key] ?? key),
    filePath: task.filePath,
    heading: (task.sectionId && index.sections.get(task.sectionId)?.heading) || '',
    line: task.lineNumber,
  }));
}

export function formatNotes(rows: readonly NoteRow[], format: ExportFormat): string {
  const cells = rows.map((row) => [row.title, row.tags.join(' '), row.filePath, String(row.line), row.updatedAt ? isoDate(row.updatedAt) : '']);
  const headers = ['Title', 'Tags', 'Note', 'Line', 'Updated'];
  switch (format) {
    case 'csv':
      return csv(headers, cells);
    case 'markdown-table':
      return markdownTable(headers, cells);
    default:
      return rows.map((row) => `- [${escapeMarkdown(row.title)}](${link(row.filePath, row.line)})${row.tags.length ? ` — ${row.tags.join(' ')}` : ''}`).join('\n') + '\n';
  }
}

export function formatTasks(rows: readonly TaskRow[], format: ExportFormat): string {
  const cells = rows.map((row) => [row.completed ? 'x' : '', row.title, row.due, row.priority, row.assignee, row.tags.join(' '), row.filePath, row.heading, String(row.line)]);
  const headers = ['Done', 'Task', 'Due', 'Priority', 'For', 'Tags', 'Note', 'Heading', 'Line'];
  switch (format) {
    case 'csv':
      return csv(headers, cells);
    case 'markdown-table':
      return markdownTable(headers, cells);
    default:
      return rows.map((row) => {
        const fileName = row.filePath.split('/').pop() ?? row.filePath;
        return `- [${row.completed ? 'x' : ' '}] ${escapeMarkdown(row.title)}${row.due ? ` 📅 ${row.due}` : ''}${row.assignee ? ` 👤 ${row.assignee}` : ''} ([${escapeMarkdown(fileName)}](${link(row.filePath, row.line)}))`;
      }).join('\n') + '\n';
  }
}

/** Asks how, and where, and does it. `text` is made only once the reader has chosen. */
export async function exportResults(
  what: string,
  count: number,
  text: (format: ExportFormat) => string,
): Promise<void> {
  if (count === 0) {
    void vscode.window.showInformationMessage(`There are no ${what} to export.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    FORMATS.flatMap((entry) => [
      { label: `Copy as ${entry.label}`, description: entry.detail, choice: { format: entry.format, to: 'clipboard' } as ExportChoice, extension: entry.extension },
      { label: `Save as ${entry.label}…`, description: entry.detail, choice: { format: entry.format, to: 'file' } as ExportChoice, extension: entry.extension },
    ]),
    { title: `Export ${count} ${what}`, placeHolder: 'Everything the search found, not only the page on screen' },
  );
  if (!picked) {
    return;
  }
  const body = text(picked.choice.format);
  if (picked.choice.to === 'clipboard') {
    await vscode.env.clipboard.writeText(body);
    void vscode.window.showInformationMessage(`Copied ${count} ${what} as ${picked.label.replace(/^Copy as /, '')}.`);
    return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`deckard-${what}.${picked.extension}`),
    filters: picked.extension === 'csv' ? { CSV: ['csv'] } : { Markdown: ['md'] },
    title: `Save ${count} ${what}`,
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  void vscode.window.showInformationMessage(`Saved ${count} ${what} to ${target.fsPath}.`);
}

/** RFC 4180: a field with a comma, a quote, or a line break is quoted, and a quote is doubled. */
export function csv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const field = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers, ...rows].map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}

/** A pipe inside a cell would end it, and a line break would end the row. */
export function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const line = (values: readonly string[]): string => `| ${values.map(cell).join(' | ')} |`;
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n') + '\n';
}

function escapeMarkdown(value: string): string {
  return value.replace(/[[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function link(filePath: string, line: number): string {
  return `${encodeURI(filePath)}#L${line}`;
}

function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
