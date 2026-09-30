import { Section, Task, WorkspaceIndex } from '../model';

/**
 * A result set, taken out.
 *
 * Deckard reads the workspace and writes back into it; nothing leaves. A
 * search copied out as Markdown or CSV makes a result usable in a pull
 * request, an issue, or a message, while the index itself still never
 * leaves the machine. The whole result goes, not the page of it on screen.
 */

/** How a result set is written out. */
export type ExportFormat = 'markdown-list' | 'markdown-table' | 'csv';

/** Each format, as the export list offers it, and the file a save names. */
export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string; detail: string; extension: string }[] = [
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

/** Each note as it goes out: its heading, tags, place, and when it changed. */
export function noteRows(sections: readonly Section[]): NoteRow[] {
  return sections.map((section) => ({
    title: section.heading,
    tags: section.tags.map((key) => section.tagLabels[key] ?? key),
    filePath: section.filePath,
    line: section.startLine,
    updatedAt: section.updatedAt,
  }));
}

/** Each task as it goes out, with the heading it is written under. */
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

/** The notes written out in `format`: a table, CSV, or a list of links. */
export function formatNotes(rows: readonly NoteRow[], format: ExportFormat): string {
  const cells = rows.map((row) => [row.title, row.tags.join(' '), row.filePath, String(row.line), row.updatedAt ? isoDate(row.updatedAt) : '']);
  const headers = ['Title', 'Tags', 'Note', 'Line', 'Updated'];
  switch (format) {
    case 'csv':
      return csv(headers, cells);
    case 'markdown-table':
      return markdownTable(headers, cells);
    case 'markdown-list':
      return rows.map((row) => `- [${escapeMarkdown(row.title)}](${link(row.filePath, row.line)})${row.tags.length ? ` — ${row.tags.join(' ')}` : ''}`).join('\n') + '\n';
  }
}

/** The tasks written out in `format`: a table, CSV, or a list that reads as tasks again. */
export function formatTasks(rows: readonly TaskRow[], format: ExportFormat): string {
  const cells = rows.map((row) => [row.completed ? 'x' : '', row.title, row.due, row.priority, row.assignee, row.tags.join(' '), row.filePath, row.heading, String(row.line)]);
  const headers = ['Done', 'Task', 'Due', 'Priority', 'For', 'Tags', 'Note', 'Heading', 'Line'];
  switch (format) {
    case 'csv':
      return csv(headers, cells);
    case 'markdown-table':
      return markdownTable(headers, cells);
    case 'markdown-list':
      return rows.map((row) => {
        const fileName = row.filePath.split('/').pop() ?? row.filePath;
        return `- [${row.completed ? 'x' : ' '}] ${escapeMarkdown(row.title)}${row.due ? ` 📅 ${row.due}` : ''}${row.assignee ? ` 👤 ${row.assignee}` : ''} ([${escapeMarkdown(fileName)}](${link(row.filePath, row.line)}))`;
      }).join('\n') + '\n';
  }
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

/** Text safe inside a Markdown link's words, on one line. */
function escapeMarkdown(value: string): string {
  return value.replace(/[[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/** The link to a line of a note, as a Markdown link target. */
function link(filePath: string, line: number): string {
  return `${encodeURI(filePath)}#L${line}`;
}

/** The UTC day of a moment, as `YYYY-MM-DD`. */
function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
