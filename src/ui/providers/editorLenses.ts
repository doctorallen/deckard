import { formatProgressCount } from '../../domain/tasks/progressCount';
import * as vscode from 'vscode';

import { pluralize } from '../../shared/text';
import { measure } from '../../shared/timing';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  describeNoteProblems,
  findDailyNoteActions,
  findEmbedProblems,
  findHubProgress,
  findStepProgress,
  findTaskDependencies,
  formatProgressBar,
  NOTE_PROBLEM_FIXES,
  NoteProblemFix,
} from '../state/editorLensState';
import { readQueryContext } from '../commands/queryContext';
import { findBreadcrumbs } from '../state/hubTree';
import { getPeriodicNoteUri } from '../commands/dailyNote';
import { CREATE_MISSING_NOTES_COMMAND } from '../commands/linkHealth';
import { resolveSourceUri } from '../commands/navigation';
import { getRolloverMode, ROLLOVER_LOOKBACK_DAYS } from '../commands/rollover';
import { LINK_MENTIONS_COMMAND } from '../commands/unlinkedMentions';
import { NoteProblemFixChoice, PICK_NOTE_PROBLEM_FIX_COMMAND } from '../commands/noteProblems';
import { readEditorToggle } from './editorToggles';
import { LazyCodeLens, locate, resolveLazyCodeLens } from './codeLenses';
import { whenPublished } from '../../core/workspace/publishing';
import { findLinkProblems, findMissingNoteNames, LinkProblem } from '../../domain/links/linkProblems';
import { formatLocalDate } from '../../domain/notes/periodicNotes';
import { findUnlinkedMentions, UnlinkedMention } from '../../domain/search/mentions';
import { ParsedFile, Task, WorkspaceIndex } from '../../domain/model';
import { formatDisplayDay } from '../../domain/markdown/dateFormat';
import { readDateFormats } from '../commands/datePrompt';

/** What the lenses read from the indexer, and when they redraw. */
interface LensIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
  parse(uri: vscode.Uri, content: string): ParsedFile;
}

/** What each group of lenses reads: the note as it is in the editor. */
interface LensContext {
  document: vscode.TextDocument;
  file: ParsedFile;
  index: WorkspaceIndex;
  /** Whether the note is in the notes folder Deckard indexes. */
  isNotesFile: boolean;
  /** The settings below that are on for the note. */
  shows: ReadonlySet<LensSetting>;
}

/** A `deckard.editor.*` setting that shows lenses. */
type LensSetting =
  | 'taskDependencies'
  | 'dailyNoteActions'
  | 'linkProblems'
  | 'embedProblems'
  | 'unlinkedMentions'
  | 'hubProgress'
  | 'breadcrumbs'
  | 'stepProgress';

/**
 * One group of lenses, and the `deckard.editor.*` settings that show it: any
 * one of them on shows the group, which draws what each one on allows.
 */
interface LensGroup {
  settings: readonly LensSetting[];
  provide(context: LensContext): LazyCodeLens[];
}

/**
 * Lenses that act, beside the counts `EditorReferences` draws: each shows only
 * when there is something to see, so a note with nothing to act on carries
 * none. See docs/editor-lenses.md.
 */
export class EditorLenses
  implements vscode.CodeLensProvider<LazyCodeLens>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private readonly groups: readonly LensGroup[] = [
    { settings: ['taskDependencies'], provide: provideTaskDependencyLenses },
    { settings: ['dailyNoteActions'], provide: provideDailyNoteLenses },
    { settings: ['linkProblems', 'unlinkedMentions'], provide: provideNoteProblemLenses },
    { settings: ['embedProblems'], provide: provideEmbedProblemLenses },
    { settings: ['hubProgress'], provide: provideHubProgressLenses },
    { settings: ['breadcrumbs'], provide: provideBreadcrumbLenses },
    { settings: ['stepProgress'], provide: provideStepProgressLenses },
  ];
  /** Before the first scan every other note looks empty. */
  private isReady = false;

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  /** Takes the index the lenses read; nothing is registered until `register`. */
  public constructor(private readonly indexer: LensIndexSource) {}

  /**
   * Registers the lenses for Markdown files, and redraws them when the index
   * or a Deckard setting changes and once the first index is published.
   * Returns the provider, so the composition root can build and register it
   * in one expression.
   */
  public register(): this {
    this.disposables.push(
      this.indexer.onDidUpdate(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard')) {
          this.changeEmitter.fire();
        }
      }),
      vscode.languages.registerCodeLensProvider({ pattern: '**/*.md' }, this),
    );
    void whenPublished(this.indexer).then(() => {
      this.isReady = true;
      this.changeEmitter.fire();
    });
    return this;
  }

  /** Unregisters the lenses and stops listening for changes. */
  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /**
   * The groups of lenses a note's settings turn on, once the first index is
   * published.
   */
  public provideCodeLenses(document: vscode.TextDocument): LazyCodeLens[] {
    if (!this.isReady || !isMarkdownFile(document.uri)) {
      return [];
    }
    const shows = new Set(
      this.groups
        .flatMap((group) => group.settings)
        .filter((setting) => readEditorToggle(setting, document.uri)),
    );
    const groups = this.groups.filter((group) => group.settings.some((setting) => shows.has(setting)));
    if (groups.length === 0) {
      return [];
    }
    return measure(
      'Action lenses',
      () => {
        const context: LensContext = {
          document,
          file: this.indexer.parse(document.uri, document.getText()),
          index: this.indexer.getSnapshot(),
          isNotesFile: this.indexer.isNotesFile(document.uri),
          shows,
        };
        return groups.flatMap((group) => group.provide(context));
      },
      (lenses) => `${lenses.length} lenses, ${document.lineCount} lines`,
    );
  }

  /** Builds a lens's command once VS Code shows it. */
  public resolveCodeLens(lens: LazyCodeLens): Promise<LazyCodeLens> {
    return resolveLazyCodeLens(lens);
  }
}

/**
 * Above a task that waits on an open task, or holds one up: how many, listed
 * in the references peek. A `⛔` name no task carries is said outright.
 */
function provideTaskDependencyLenses({
  document,
  file,
  index,
}: LensContext): LazyCodeLens[] {
  return findTaskDependencies(file, index).flatMap((task) => {
    const range = new vscode.Range(task.line, 0, task.line, 0);
    const lenses: LazyCodeLens[] = [];
    if (task.waitingOn.length > 0) {
      lenses.push(
        createTasksLens(
          document.uri,
          range,
          `Waiting on ${pluralize(task.waitingOn.length, 'open task')}`,
          task.waitingOn,
        ),
      );
    }
    if (task.blocking.length > 0) {
      lenses.push(
        createTasksLens(
          document.uri,
          range,
          `Blocks ${pluralize(task.blocking.length, 'open task')}`,
          task.blocking,
        ),
      );
    }
    if (task.missingIds.length > 0) {
      lenses.push(
        new LazyCodeLens(range, () => ({
          title: `No task has 🆔 ${task.missingIds.join(', ')}`,
          tooltip:
            'This task waits on a name no task in the workspace carries: a typo, or a task since deleted',
          command: '',
        })),
      );
    }
    return lenses;
  });
}

/**
 * Above a daily note: the notes before and after it, and on today's note the
 * unfinished tasks earlier ones still hold. A side with no note has no arrow.
 */
function provideDailyNoteLenses({
  document,
  file,
  index,
}: LensContext): LazyCodeLens[] {
  const now = new Date();
  const actions = findDailyNoteActions({
    file,
    index,
    today: formatLocalDate(now),
    lookbackDays: ROLLOVER_LOOKBACK_DAYS,
    mode: getRolloverMode(document.uri) === 'migrate' ? 'migrate' : 'move',
  });
  if (!actions) {
    return [];
  }
  const range = new vscode.Range(0, 0, 0, 0);
  const lenses: LazyCodeLens[] = [];
  // A rollover writes into the note Deckard keeps for today, so it is offered
  // only there, not on another note that happens to carry today's date.
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const isTodaysNote =
    folder !== undefined &&
    getPeriodicNoteUri(folder, 'day', now).toString() ===
      document.uri.toString();
  if (isTodaysNote && actions.carryIn.length > 0) {
    const verb = getRolloverMode(document.uri) === 'migrate' ? 'Migrate' : 'Move';
    lenses.push(
      new LazyCodeLens(range, () => ({
        title: `Carry in ${pluralize(actions.carryIn.length, 'unfinished task')}`,
        tooltip: `${verb} the unfinished tasks from earlier daily notes into this one`,
        command: 'deckard.rollTasksForward',
      })),
    );
  }
  // The days are written as the reader reads a date.
  const formats = readDateFormats();
  if (actions.previous) {
    const previous = formatDisplayDay(actions.previous, formats);
    lenses.push(
      new LazyCodeLens(range, () => ({
        title: `‹ ${previous}`,
        tooltip: `Open the daily note for ${previous}`,
        command: 'deckard.previousDailyNote',
      })),
    );
  }
  if (actions.next) {
    const next = formatDisplayDay(actions.next, formats);
    lenses.push(
      new LazyCodeLens(range, () => ({
        title: `${next} ›`,
        tooltip: `Open the daily note for ${next}`,
        command: 'deckard.nextDailyNote',
      })),
    );
  }
  return lenses;
}

/**
 * Above a task with steps: a bar of how many are done, and the next one,
 * which selecting the lens goes to. Once every step is done it says so,
 * and does nothing.
 */
function provideStepProgressLenses({ document, file }: LensContext): LazyCodeLens[] {
  return findStepProgress(file).map((progress) => {
    const range = new vscode.Range(progress.line, 0, progress.line, 0);
    const counts = `Steps ${formatProgressCount(progress.done, progress.total)}`;
    return new LazyCodeLens(range, () => {
      const title = `${formatProgressBar(progress.done, progress.total)} ${counts}`;
      if (progress.nextLine === undefined) {
        return { title, tooltip: 'Every step is done: the task can be completed', command: '' };
      }
      const next = new vscode.Range(progress.nextLine, 0, progress.nextLine, 0);
      return {
        title: `${title} · next: ${progress.next ?? ''}`,
        tooltip: 'Go to the next open step',
        command: 'vscode.open',
        arguments: [document.uri, { selection: next }],
      };
    });
  });
}

/**
 * On a note's first line: where it sits under its hubs, from the namespace
 * down, as the Hubs view files it, which opens the note above it. A note no
 * hub holds has none.
 */
function provideBreadcrumbLenses({ file, index, isNotesFile }: LensContext): LazyCodeLens[] {
  if (!isNotesFile) {
    return [];
  }
  const range = new vscode.Range(0, 0, 0, 0);
  return findBreadcrumbs(index, file.filePath).map(
    (crumb) =>
      new LazyCodeLens(range, () => {
        return {
          title: crumb.labels.join(' › '),
          tooltip: `Open ${crumb.labels[crumb.labels.length - 2] ?? 'the note above this one'}, where your notes open: the editor or the note page`,
          command: 'deckard.openNote',
          arguments: [crumb.parent],
        };
      }),
  );
}

/**
 * On a hub note's first line: how far along the tasks of each tag it
 * describes are, which opens the tag's page. A tag with no task has none.
 */
function provideHubProgressLenses({ file, index }: LensContext): LazyCodeLens[] {
  const progress = findHubProgress(file, index, readQueryContext());
  const range = new vscode.Range(0, 0, 0, 0);
  return progress.map(
    (entry) =>
      new LazyCodeLens(range, () => ({
        title: progress.length > 1 ? `${entry.tagLabel}: ${entry.text}` : `Progress: ${entry.text}`,
        tooltip: `Open ${entry.tagLabel}'s page, with every task it finds`,
        command: 'deckard.showTagOverview',
        arguments: [entry.tagKey],
      })),
  );
}

/**
 * On a note's first line: one lens for its problems, such as
 * "2 missing · 4 unlinked", the `[[links]]` in it that open no note and the
 * other notes that name it without linking to it. Each kind is counted only
 * while its own setting is on. With one kind the lens fixes it, and with both
 * it lists each fix. The links are read from the editor, so they follow
 * unsaved edits the way the diagnostics on them do.
 */
function provideNoteProblemLenses({
  document,
  file,
  index,
  isNotesFile,
  shows,
}: LensContext): LazyCodeLens[] {
  // Only notes are checked, as the diagnostics check only notes: a Markdown
  // file outside the notes folder links into notes it is not part of, and
  // only a note is what a `[[link]]` to it opens.
  if (!isNotesFile) {
    return [];
  }
  const problems = shows.has('linkProblems')
    ? findLinkProblems(document.getText(), index, file.filePath)
    : [];
  const mentions = shows.has('unlinkedMentions') ? findUnlinkedMentions(file, index) : [];
  const names = findMissingNoteNames(problems);
  const summary = describeNoteProblems({
    missing: problems.filter((problem) => problem.kind === 'missing').length,
    ambiguous: problems.filter((problem) => problem.kind === 'ambiguous').length,
    creatable: names.length,
    mentions: mentions.length,
    mentionNotes: new Set(mentions.map((mention) => mention.filePath)).size,
  });
  if (!summary) {
    return [];
  }
  const range = new vscode.Range(0, 0, 0, 0);
  const fixes = createNoteProblemFixes(document.uri, problems, names, mentions);
  return [
    new LazyCodeLens(range, async () => {
      const { title, tooltip } = summary;
      if (summary.action !== 'pick') {
        const { command } = await fixes[summary.action]();
        return { ...command, title, tooltip };
      }
      return {
        title,
        tooltip,
        command: PICK_NOTE_PROBLEM_FIX_COMMAND,
        arguments: [await Promise.all(summary.fixes.map((fix) => fixes[fix]()))],
      };
    }),
  ];
}

/**
 * What each fix the problems lens offers runs, each built only when the lens
 * can reach it, since finding where the mentions are reads other notes.
 */
function createNoteProblemFixes(
  uri: vscode.Uri,
  problems: readonly LinkProblem[],
  names: readonly string[],
  mentions: readonly UnlinkedMention[],
): Record<NoteProblemFix, () => Promise<NoteProblemFixChoice>> {
  // The references view opens at the lens, on the note's first line.
  const start = new vscode.Position(0, 0);
  return {
    showBrokenLinks: async () => ({
      label: NOTE_PROBLEM_FIXES.showBrokenLinks,
      detail: `${pluralize(problems.length, 'link')} that open${problems.length === 1 ? 's' : ''} no note, in the references view`,
      command: {
        title: NOTE_PROBLEM_FIXES.showBrokenLinks,
        command: 'editor.action.showReferences',
        arguments: [
          uri,
          start,
          problems.map(
            (problem) =>
              new vscode.Location(
                uri,
                new vscode.Range(problem.line, problem.startColumn, problem.line, problem.endColumn),
              ),
          ),
        ],
      },
    }),
    createMissingNotes: async () => ({
      label: NOTE_PROBLEM_FIXES.createMissingNotes,
      detail: `${names.map((name) => `"${name}"`).join(', ')}, in your notes folder`,
      command: {
        title: NOTE_PROBLEM_FIXES.createMissingNotes,
        command: CREATE_MISSING_NOTES_COMMAND,
        arguments: [uri.toString(), names],
      },
    }),
    showMentions: async () => ({
      label: NOTE_PROBLEM_FIXES.showMentions,
      detail: 'Where other notes name this one without a link, in the references view',
      command: {
        title: NOTE_PROBLEM_FIXES.showMentions,
        command: 'editor.action.showReferences',
        arguments: [uri, start, await locate(
          mentions,
          (mention) => mention.filePath,
          (mention) =>
            new vscode.Range(mention.line, mention.startColumn, mention.line, mention.endColumn),
        )],
      },
    }),
    linkMentions: async () => ({
      label: NOTE_PROBLEM_FIXES.linkMentions,
      detail: `Turn ${mentions.length === 1 ? 'the mention' : `each of the ${mentions.length} mentions`} into a [[link]] to this note`,
      command: {
        title: NOTE_PROBLEM_FIXES.linkMentions,
        command: LINK_MENTIONS_COMMAND,
        arguments: [uri.toString()],
      },
    }),
  };
}

/**
 * Above an embed the preview cannot draw: what went missing, as the preview
 * says it. Selecting it opens the note the embed names, where the heading or
 * `^marker` was renamed or removed. An embed that draws carries nothing; the
 * link inside it already opens its note.
 */
function provideEmbedProblemLenses({
  file,
  index,
}: LensContext): LazyCodeLens[] {
  return findEmbedProblems(file, index).map((problem) => {
    const range = new vscode.Range(problem.line, 0, problem.line, 0);
    const title = `Embed: ${problem.reason}`;
    const filePath = problem.filePath;
    return new LazyCodeLens(range, async () => {
      const uri = filePath ? await resolveSourceUri(filePath) : undefined;
      return uri
        ? {
            title,
            tooltip: 'Open the note this embed names',
            command: 'vscode.open',
            arguments: [uri],
          }
        : { title, command: '' };
    });
  });
}

/** A count that lists tasks in VS Code's references peek. */
function createTasksLens(
  documentUri: vscode.Uri,
  range: vscode.Range,
  title: string,
  tasks: readonly Task[],
): LazyCodeLens {
  return new LazyCodeLens(range, async () => ({
    title,
    tooltip: 'Show them in the references view',
    command: 'editor.action.showReferences',
    arguments: [documentUri, range.start, await locate(
      tasks,
      (task) => task.filePath,
      (task) => new vscode.Position(task.lineNumber - 1, Math.max(task.checkboxColumn - 1, 0)),
    )],
  }));
}
