import * as path from 'path';

import * as vscode from 'vscode';

import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { parseQuery } from '../../domain/query/queryParser';
import { QueryContext } from '../../domain/query/queryContext';
import { stripTags } from '../../domain/markdown/parser';
import { buildTaskCalendar, CalendarTask } from '../../domain/tasks/taskCalendar';
import { WorkspaceIndex } from '../../domain/model';
import { readQueryContext } from './queryContext';
import { Failure, openSettingAction, reportFailure } from './notify';

/** What the calendar reads from the indexer: its snapshots, and where each note is. */
export interface CalendarIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
  getUri(filePath: string): vscode.Uri | undefined;
}

/** The search a calendar lists when `deckard.calendar.exportQuery` names none. */
export const DEFAULT_CALENDAR_QUERY = 'is:open';

/** How long the file waits after an edit before it is written, so a burst of saves writes once. */
const WRITE_DELAY_MS = 2000;

/** What building the calendar came to: the file's text, or why the search could not run. */
export type CalendarBuild = { kind: 'calendar'; text: string; count: number } | { kind: 'error'; message: string };

/**
 * The calendar of the tasks a search finds that have a due or scheduled
 * date, soonest first, each linking back to its line in VS Code.
 */
export function buildCalendarFor(
  indexer: Pick<CalendarIndexSource, 'getUri'>,
  index: WorkspaceIndex,
  query: string,
  context: QueryContext,
): CalendarBuild {
  const parsed = parseQuery(query);
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (!parsed.node || error) {
    return { kind: 'error', message: error?.message ?? 'The search is empty.' };
  }
  const tasks: CalendarTask[] = evaluateQuery(index, parsed.node, context)
    .tasks.filter((task) => task.dueAt !== undefined || task.scheduledAt !== undefined)
    .sort(
      (left, right) =>
        (left.dueAt ?? left.scheduledAt ?? 0) - (right.dueAt ?? right.scheduledAt ?? 0) ||
        left.filePath.localeCompare(right.filePath) ||
        left.lineNumber - right.lineNumber,
    )
    .map((task) => {
      const uri = indexer.getUri(task.filePath);
      return {
        title: stripTags(task.title).trim() || task.title,
        filePath: task.filePath,
        lineNumber: task.lineNumber,
        dueAt: task.dueAt,
        scheduledAt: task.scheduledAt,
        completed: task.completed,
        updatedAt: index.files.get(task.filePath)?.updatedAt ?? task.updatedAt,
        ...(uri ? { url: `${vscode.env.uriScheme}://file${encodeURI(uri.path)}:${task.lineNumber}` } : {}),
      };
    });
  const name = vscode.workspace.name ? `Deckard: ${vscode.workspace.name}` : 'Deckard tasks';
  return { kind: 'calendar', text: buildTaskCalendar(tasks, name), count: tasks.length };
}

/** The search `deckard.calendar.exportQuery` names, or every open task. */
function readCalendarQuery(): string {
  const query = vscode.workspace.getConfiguration('deckard').get<string>('calendar.exportQuery', DEFAULT_CALENDAR_QUERY);
  return typeof query === 'string' && query.trim() ? query.trim() : DEFAULT_CALENDAR_QUERY;
}

/**
 * The file `deckard.calendar.exportFile` names: an absolute path as it is,
 * a relative one in the first workspace folder; none when it names nothing.
 */
export function resolveCalendarFile(setting: string | undefined): vscode.Uri | undefined {
  const written = typeof setting === 'string' ? setting.trim() : '';
  if (!written) {
    return undefined;
  }
  if (path.isAbsolute(written)) {
    return vscode.Uri.file(written);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, ...written.split(/[\\/]+/)) : undefined;
}

/**
 * Keeps the file `deckard.calendar.exportFile` names up to date with the
 * tasks `deckard.calendar.exportQuery` finds, so a calendar app subscribed
 * to it follows the notes. It writes only when the calendar changed, and
 * says once, not on every save, when it cannot.
 */
export class TaskCalendarFile implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastWritten: { file: string; text: string } | undefined;
  private lastProblem: string | undefined;

  /** Takes the index it lists tasks from; nothing happens until `start`. */
  public constructor(private readonly indexer: CalendarIndexSource) {}

  /** Writes the file after each index update and setting change, and once now. Returns itself. */
  public start(): this {
    this.disposables.push(
      this.indexer.onDidUpdate(() => this.schedule()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('deckard.calendar.exportFile') && !event.affectsConfiguration('deckard.calendar.exportQuery')) {
          return;
        }
        this.lastProblem = undefined;
        this.schedule(0);
      }),
    );
    this.schedule(0);
    return this;
  }

  /** Stops writing. */
  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /** Writes the file once the edits have settled. */
  private schedule(delay = WRITE_DELAY_MS): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.write();
    }, delay);
  }

  /** Writes the calendar when it differs from what was last written there. */
  public async write(): Promise<void> {
    const file = resolveCalendarFile(vscode.workspace.getConfiguration('deckard').get<string>('calendar.exportFile', ''));
    if (!file) {
      return;
    }
    const built = buildCalendarFor(this.indexer, this.indexer.getSnapshot(), readCalendarQuery(), readQueryContext());
    if (built.kind === 'error') {
      this.report({
        outcome: `Deckard did not update the calendar file, because its search does not run: ${built.message}`,
        fix: 'Change the calendar’s search.',
        action: openSettingAction('calendar.exportQuery'),
      });
      return;
    }
    if (this.lastWritten?.file === file.toString() && this.lastWritten.text === built.text) {
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
      await vscode.workspace.fs.writeFile(file, Buffer.from(built.text, 'utf8'));
      this.lastWritten = { file: file.toString(), text: built.text };
      this.lastProblem = undefined;
    } catch (error) {
      this.report({
        outcome: `Deckard could not write the calendar file ${path.basename(file.fsPath)}.`,
        fix: 'Check that its folder can be written to, or choose another file.',
        error,
        action: openSettingAction('calendar.exportFile'),
      });
    }
  }

  /** Says a problem once, until the settings change or a write succeeds. */
  private report(failure: Failure): void {
    if (this.lastProblem === failure.outcome) {
      return;
    }
    this.lastProblem = failure.outcome;
    void reportFailure({ ...failure, severity: 'warning' });
  }
}

/**
 * Export Tasks as Calendar: writes the tasks the calendar search finds to a
 * file the reader picks, to import into a calendar app once.
 */
export async function exportTaskCalendarCommand(indexer: CalendarIndexSource): Promise<void> {
  const built = buildCalendarFor(indexer, indexer.getSnapshot(), readCalendarQuery(), readQueryContext());
  if (built.kind === 'error') {
    void reportFailure({
      outcome: `Deckard did not export the calendar, because its search does not run: ${built.message}`,
      fix: 'Change the calendar’s search.',
      action: openSettingAction('calendar.exportQuery'),
    });
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    title: 'Deckard: Export Tasks as Calendar',
    saveLabel: 'Export',
    filters: { Calendar: ['ics'] },
    ...(folder ? { defaultUri: vscode.Uri.joinPath(folder, 'deckard-tasks.ics') } : {}),
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(built.text, 'utf8'));
  const reveal = 'Reveal in File Explorer';
  const keep = 'Keep It Up to Date';
  const choice = await vscode.window.showInformationMessage(
    `Exported ${built.count} ${built.count === 1 ? 'task' : 'tasks'} to ${path.basename(target.fsPath)}. Import it into your calendar app, or keep it up to date to subscribe to it.`,
    reveal,
    keep,
  );
  if (choice === reveal) {
    await vscode.commands.executeCommand('revealFileInOS', target);
  } else if (choice === keep) {
    await vscode.workspace.getConfiguration('deckard').update('calendar.exportFile', target.fsPath, vscode.ConfigurationTarget.Workspace);
  }
}
