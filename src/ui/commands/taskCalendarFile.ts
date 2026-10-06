import * as os from 'os';
import { isCancelledTask } from '../../domain/tasks/taskStatuses';
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
  /** Settles once the first scan has read the notes; nothing is written before it. */
  readonly ready?: Promise<void>;
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
        ...(isCancelledTask(task) ? { cancelled: true } : {}),
        updatedAt: index.files.get(task.filePath)?.updatedAt ?? task.updatedAt,
        ...(uri ? { url: fileLink(uri, task.lineNumber) } : {}),
      };
    });
  const name = vscode.workspace.name ? `Deckard: ${vscode.workspace.name}` : 'Deckard tasks';
  return { kind: 'calendar', text: buildTaskCalendar(tasks, name), count: tasks.length };
}

/**
 * The link that opens a note at a line in VS Code, each part of its path
 * escaped, `#` and `?` among them, and a UNC path's server kept.
 */
export function fileLink(uri: vscode.Uri, line: number): string {
  const path = uri.path.split('/').map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))).join('/');
  const server = uri.authority ? `//${encodeURIComponent(uri.authority)}` : '';
  return `${vscode.env.uriScheme}://file${server}${path}:${line}`;
}

/** The search `deckard.calendar.exportQuery` names, or every open task. */
function readCalendarQuery(): string {
  const query = vscode.workspace.getConfiguration('deckard').get<string>('calendar.exportQuery', DEFAULT_CALENDAR_QUERY);
  return typeof query === 'string' && query.trim() ? query.trim() : DEFAULT_CALENDAR_QUERY;
}

/**
 * The file `deckard.calendar.exportFile` names: an absolute path as it is,
 * `~` read as the home folder, a relative one in the first workspace
 * folder. None when it names nothing, names no `.ics` file, or climbs out
 * of the folder it is relative to, so a setting in a workspace's own
 * settings can only write a calendar, and only inside the workspace.
 */
export function resolveCalendarFile(setting: string | undefined): vscode.Uri | undefined {
  const written = typeof setting === 'string' ? setting.trim() : '';
  if (!written || !/\.ics$/i.test(written)) {
    return undefined;
  }
  if (written === '~' || written.startsWith('~/') || written.startsWith('~\\')) {
    return vscode.Uri.file(path.join(os.homedir(), written.slice(1)));
  }
  if (path.isAbsolute(written)) {
    return vscode.Uri.file(written);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  const parts = written.split(/[\\/]+/).filter(Boolean);
  if (!folder || parts.includes('..')) {
    return undefined;
  }
  return vscode.Uri.joinPath(folder.uri, ...parts);
}

/** Whether a file is missing, or is a calendar, which only may be written over. */
async function isCalendarOrMissing(file: vscode.Uri): Promise<boolean> {
  try {
    const head = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8', 0, 64);
    return head.replace(/^\uFEFF/, '').trimStart().startsWith('BEGIN:VCALENDAR');
  } catch {
    return true;
  }
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
  /** Whether the first scan has read the notes. */
  private ready = false;

  /** Takes the index it lists tasks from; nothing happens until `start`. */
  public constructor(private readonly indexer: CalendarIndexSource) {}

  /**
   * Writes the file after each index update and setting change, and once
   * the first scan has read the notes: written before it, the calendar
   * would be empty, and an app reading it then would drop every event.
   * Returns itself.
   */
  public start(): this {
    this.disposables.push(
      this.indexer.onDidUpdate(() => {
        if (this.ready) {
          this.schedule();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('deckard.calendar.exportFile') && !event.affectsConfiguration('deckard.calendar.exportQuery')) {
          return;
        }
        this.lastProblem = undefined;
        if (this.ready) {
          this.schedule(0);
        }
      }),
    );
    void Promise.resolve(this.indexer.ready).then(() => {
      this.ready = true;
      this.schedule(0);
    });
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
    const setting = vscode.workspace.getConfiguration('deckard').get<string>('calendar.exportFile', '');
    const file = resolveCalendarFile(setting);
    if (!file) {
      if (typeof setting === 'string' && setting.trim()) {
        this.report({
          outcome: 'Deckard did not write the calendar file, because its path names no .ics file, or climbs out of the workspace folder.',
          fix: 'Choose a path that ends in .ics, inside the workspace or absolute.',
          action: openSettingAction('calendar.exportFile'),
        });
      }
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
    if (!(await isCalendarOrMissing(file))) {
      this.report({
        outcome: `Deckard did not write the calendar file, because ${path.basename(file.fsPath)} is already there and is not a calendar.`,
        fix: 'Choose another file, or remove that one.',
        action: openSettingAction('calendar.exportFile'),
      });
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
    await keepUpToDate(target);
  }
}

/**
 * Keep It Up to Date: names the exported file in deckard.calendar.exportFile.
 * Inside the workspace it is named relatively, so it holds on another
 * machine; with no folder open there is no workspace to keep it in.
 */
async function keepUpToDate(target: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const relative = folder ? path.relative(folder.uri.fsPath, target.fsPath) : '';
  const inside = Boolean(folder) && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  await vscode.workspace
    .getConfiguration('deckard')
    .update(
      'calendar.exportFile',
      inside ? relative.split(path.sep).join('/') : target.fsPath,
      folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
    );
}
