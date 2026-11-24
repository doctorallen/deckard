import * as vscode from 'vscode';

import type { IndexControl, IndexReader } from '../../core/workspace/indexReader';
import type { NoteLinkStyle } from '../../domain/markdown/wikiLinks';
import type { WorkspaceIndex } from '../../domain/model';
import { orderPicks } from '../../domain/notes/meetings';
import {
  findTopSection,
  planTopTasks,
  readTopCount,
  type TopChoice,
  topLimitSentence,
  topTasksName,
} from '../../domain/tasks/topTasks';
import { settingLabel } from '../state/settingLabel';
import { buildTopRows, type TopRow, type TopRowGroup, type TopRows } from '../state/topTasksState';
import { getAgendaQuery } from './agendaActions';
import { chooseTargetFolder, getPeriodicNoteUri } from './dailyNote';
import { fileExists } from './fs';
import { resolveSourceUri } from './navigation';
import { noteName, reportFailure } from './notify';
import { showQuickPickUntilHidden } from './prompts';
import { readQueryContext } from './queryContext';
import { ensureDailyNoteWithRollover, VscodeRolloverService } from './rollover';
import { WorkspaceWriteHistory, type WriteHandle } from './workspaceWrites';

/**
 * Deckard: Pick Today's Top Tasks (docs/implementation/50-top-three.md):
 * lists the open tasks with checkboxes, today's picks checked, refuses one
 * more than `deckard.tasks.topCount`, and writes what is checked into
 * today's note as its `## Top three` section, each a link to its task's
 * line. The rules are domain/tasks/topTasks.ts's; this asks and writes.
 */

/** The command, which the status bar item, the lens, and the Tasks view run. */
export const PICK_TOP_TASKS_COMMAND = 'deckard.pickTopTasks';

/** A row of the picker: a task, a new task typed in it, the offer to add one, or a line between groups. */
export interface TopItem extends vscode.QuickPickItem {
  /** The task the row picks; absent on a new task, the offer, and a line between groups. */
  row?: TopRow;
  /** The words of a task to write new, on a row made from what was typed and on the offer to make one. */
  newTitle?: string;
  /** Set on the offer, **Add "…" as a new task in today's note**, which becomes a row when checked. */
  offer?: true;
}

/** What each group of the list is headed, apart from the earlier picks, whose words name their day. */
const GROUP_LABELS: Readonly<Record<Exclude<TopRowGroup, 'left'>, string>> = {
  chosen: 'Chosen',
  overdue: 'Overdue',
  today: 'Due today',
  urgent: 'Most urgent',
};

/** The picker's list: each group that has a task, headed, its tasks with why they are listed and where they are written. */
export function buildTopItems({ rows, leftLabel }: TopRows): TopItem[] {
  const items: TopItem[] = [];
  let group: TopRowGroup | undefined;
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      items.push({ label: row.group === 'left' ? leftLabel : GROUP_LABELS[row.group], kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({ label: row.task.title, description: row.detail, row });
  }
  return items;
}

/** What a change of the checked rows comes to: the rows now checked, in the order they were, and why one was refused. */
export interface TopSelection {
  checked: TopItem[];
  /** What the list says when a change was refused. */
  refused?: string;
}

/**
 * The rows checked after a change, from those checked before it and those
 * the list now reports. One more than the limit is refused, and so is
 * unchecking a pick that is done, or one written under the heading itself;
 * the rest of the change stands. The order is the order rows were checked.
 */
export function reviseTopSelection(checked: readonly TopItem[], selected: readonly TopItem[], count: number): TopSelection {
  const kept = checked.filter((item) => !selected.includes(item) && item.row?.stays);
  const wanted = [...selected, ...kept];
  const added = wanted.filter((item) => !checked.includes(item));
  if (added.length > 0 && wanted.length > count) {
    return {
      checked: orderPicks(checked, wanted.filter((item) => checked.includes(item))),
      refused: `${topLimitSentence(count)} Uncheck one to pick "${added[0].newTitle ?? added[0].label}".`,
    };
  }
  const stays = kept[0];
  return {
    checked: orderPicks(checked, wanted),
    ...(stays
      ? {
          refused: stays.row?.stays === 'done'
            ? `"${stays.label}" is done today, so it stays.`
            : `"${stays.label}" is written under the heading, so it stays. Move or delete its line to drop it.`,
        }
      : {}),
  };
}

/** The list's title: **Today's top three · 2 of 3 chosen**. */
export function describeTopTitle(count: number, chosen: number): string {
  return `Today's ${topTasksName(count).toLowerCase()} · ${chosen} of ${count} chosen`;
}

/** The offer to write what was typed as a new task, when the words match no row; undefined otherwise. */
export function createTopOffer(typed: string, items: readonly TopItem[]): TopItem | undefined {
  const title = typed.replace(/\s+/g, ' ').trim();
  const words = title.toLowerCase().split(' ');
  const matches = (item: TopItem): boolean => {
    const text = `${item.label} ${item.description ?? ''}`.toLowerCase();
    return item.kind !== vscode.QuickPickItemKind.Separator && words.every((word) => text.includes(word));
  };
  return !title || items.some(matches)
    ? undefined
    : { label: `$(add) Add "${title}" as a new task in today's note`, alwaysShow: true, offer: true, newTitle: title };
}

/** What a checked row picks. */
function toChoice(item: TopItem): TopChoice[] {
  if (item.row) {
    return [{ task: item.row.task }];
  }
  return item.newTitle ? [{ title: item.newTitle }] : [];
}

/**
 * How long after the list's rows are replaced a report of nothing checked
 * is taken as the list redrawing, not as every row being unchecked.
 */
const REDRAW_MS = 250;

/** Asks for the day's picks; undefined when the list is dismissed, and none for Enter with nothing checked. */
function askTopTasks(rows: TopRows, count: number): Promise<TopChoice[] | undefined> {
  let fixed = buildTopItems(rows);
  let checked = fixed.filter((item) => item.row?.group === 'chosen');
  let offer: TopItem | undefined;
  let redrawnAt = 0;
  return showQuickPickUntilHidden<TopItem, TopChoice[]>({
    configure: (pick) => {
      const draw = (): void => {
        redrawnAt = Date.now();
        pick.items = offer ? [...fixed, offer] : fixed;
        pick.selectedItems = checked;
      };
      const say = (refused?: string): void => {
        pick.title = refused ? `Today's ${topTasksName(count).toLowerCase()} · ${refused}` : describeTopTitle(count, checked.length);
      };
      pick.placeholder = 'Check the tasks to do first today, or type to find one or to add a new one';
      pick.canSelectMany = true;
      pick.matchOnDescription = true;
      draw();
      say();
      pick.onDidChangeValue((value) => {
        const next = createTopOffer(value, fixed);
        if (next?.label === offer?.label) {
          return;
        }
        offer = next;
        draw();
      });
      pick.onDidChangeSelection((selected) => {
        // Replacing the rows can report nothing checked before the checks are put back.
        if (selected.length === 0 && checked.length > 0 && Date.now() - redrawnAt < REDRAW_MS) {
          pick.selectedItems = checked;
          return;
        }
        // The offer, checked, becomes a row of its own, which leads the list.
        const made = selected.some((item) => item.offer) && offer?.newTitle
          ? { label: offer.newTitle, description: "a new task in today's note", alwaysShow: true, newTitle: offer.newTitle }
          : undefined;
        const revised = reviseTopSelection(checked, selected.map((item) => (item.offer && made ? made : item)), count);
        checked = revised.checked;
        if (made) {
          fixed = [made, ...fixed];
          offer = undefined;
          pick.value = '';
          draw();
        } else if (selected.length !== checked.length || selected.some((item) => !checked.includes(item))) {
          pick.selectedItems = checked;
        }
        say(revised.refused);
      });
    },
    accept: () => checked.flatMap(toChoice),
  });
}

type TopIndexer = IndexReader<vscode.Uri> & Pick<IndexControl, 'refresh'>;

/** What picking writes through: the index, the history its write is kept in, and the rollover a new daily note starts with. */
export interface TopTaskServices {
  indexer: TopIndexer;
  history: WorkspaceWriteHistory;
  rollover: VscodeRolloverService;
}

/** Says the feature is off, and offers the setting that turns it on. */
async function reportTurnedOff(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Today's top tasks are turned off: the "${settingLabel('tasks.topCount')}" setting is 0.`,
    'Open Setting',
  );
  if (choice === 'Open Setting') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'deckard.tasks.topCount');
  }
}

/**
 * Picks today's top tasks: makes today's note when it is not there, with
 * the tasks a rollover carries in, so the list is of the tasks as they
 * then are; asks; and writes what was checked.
 */
export async function pickTopTasks({ indexer, history, rollover }: TopTaskServices): Promise<void> {
  const count = readTopCount(vscode.workspace.getConfiguration('deckard'));
  if (count === 0) {
    await reportTurnedOff();
    return;
  }
  await indexer.ready;
  const folder = await chooseTargetFolder();
  if (!folder) {
    return;
  }
  const isNew = !(await fileExists(getPeriodicNoteUri(folder, 'day', new Date())));
  const todayUri = await ensureDailyNoteWithRollover(indexer, rollover, folder);
  if (isNew) {
    await indexer.refresh();
  }
  const rows = buildTopRows(indexer.getSnapshot(), readQueryContext(), { query: getAgendaQuery(), count });
  const choices = await askTopTasks(rows, count);
  if (!choices) {
    return;
  }
  const written = await writeTopTasks(history, {
    index: indexer.getSnapshot(),
    todayUri,
    todayPath: indexer.getFilePath(todayUri),
    count,
    choices,
    uriOf: findTaskNote,
  });
  if (written.kind === 'refused') {
    void reportFailure({ outcome: `Deckard could not write today's picks: ${written.reason}` });
    return;
  }
  if (written.kind !== 'written') {
    return;
  }
  const name = topTasksName(count).toLowerCase();
  written.handle.offerUndo(
    choices.length > 0 ? `Today's ${name}: ${choices.length} picked, in ${noteName(todayUri)}.` : `Cleared today's ${name}.`,
    { guard: 'latest', done: "Took today's picks back." },
    { label: 'Open', run: () => openTopSection(todayUri) },
  );
}

/** Opens today's note at its section's heading. */
async function openTopSection(todayUri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(todayUri);
  const line = findTopSection(document.getText().split(/\r?\n/))?.headingLine ?? 0;
  const position = new vscode.Position(line, 0);
  await vscode.window.showTextDocument(document, { preview: false, selection: new vscode.Range(position, position) });
}

/** A day's picks to write: the picks, today's note, and the index the picked tasks were read from. */
export interface TopWrite {
  index: WorkspaceIndex;
  todayUri: vscode.Uri;
  /** Today's note's path in the workspace, as links between notes are resolved. */
  todayPath: string;
  /** `deckard.tasks.topCount`, which names a section written new. */
  count: number;
  /** The picks, in the order they were checked. */
  choices: readonly TopChoice[];
  /** The note at a path of the index, which a picked task's marker is written in; undefined when it is not there. */
  uriOf(filePath: string): Promise<vscode.Uri | undefined>;
}

/** What writing a day's picks came to. */
export type TopWriteResult =
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: string }
  | { kind: 'written'; handle: WriteHandle };

/**
 * Writes a day's picks: today's section, and a marker at the end of each
 * picked line that has none, as one change, which Deckard: Undo Last
 * Change takes back whole. Nothing is written when a picked task's line no
 * longer reads as the index read it, since its marker would land on
 * another line.
 */
export async function writeTopTasks(
  history: WorkspaceWriteHistory,
  { index, todayUri, todayPath, count, choices, uriOf }: TopWrite,
): Promise<TopWriteResult> {
  const today = await vscode.workspace.openTextDocument(todayUri);
  const documents = new Map<string, vscode.TextDocument>([[todayPath, today]]);
  for (const choice of choices) {
    if (!('task' in choice)) {
      continue;
    }
    const { task } = choice;
    const document = documents.get(task.filePath) ?? (await openNote(await uriOf(task.filePath)));
    if (!document || task.lineNumber > document.lineCount || document.lineAt(task.lineNumber - 1).text !== task.sourceLineText) {
      return { kind: 'refused', reason: `"${task.title}" has changed since it was listed, so nothing was written.` };
    }
    documents.set(task.filePath, document);
  }
  const plan = planTopTasks({ index, content: today.getText(), todayPath, style: readLinkStyle(todayUri), count, choices });
  if (!plan.today && plan.markers.length === 0) {
    return { kind: 'unchanged' };
  }
  const edit = new vscode.WorkspaceEdit();
  if (plan.today) {
    const { start, end, text } = plan.today;
    edit.replace(todayUri, new vscode.Range(start.line, start.character, end.line, end.character), text);
  }
  for (const { task, line } of plan.markers) {
    const document = documents.get(task.filePath);
    if (document) {
      edit.replace(document.uri, document.lineAt(task.lineNumber - 1).range, line);
    }
  }
  const written = await history.write(edit, {
    label: "picking today's top tasks",
    // The section and the markers it links to are one gesture.
    preview: 'never',
    together: true,
  });
  return written.applied ? { kind: 'written', handle: written.handle } : { kind: 'refused', reason: 'the edit was not applied.' };
}

/** The note a picked task is written in, by its path in the index; undefined when it is no longer there. */
async function findTaskNote(filePath: string): Promise<vscode.Uri | undefined> {
  const uri = await resolveSourceUri(filePath);
  return uri && (await fileExists(uri)) ? uri : undefined;
}

/** A note, opened; undefined for none. */
async function openNote(uri: vscode.Uri | undefined): Promise<vscode.TextDocument | undefined> {
  return uri ? vscode.workspace.openTextDocument(uri) : undefined;
}

/** `deckard.links.style` for a note. */
function readLinkStyle(uri: vscode.Uri): NoteLinkStyle {
  return vscode.workspace.getConfiguration('deckard', uri).get<string>('links.style', 'wiki') === 'markdown'
    ? 'markdown'
    : 'wiki';
}
