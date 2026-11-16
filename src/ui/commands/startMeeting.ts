import * as vscode from 'vscode';

import type { IndexControl, IndexReader } from '../../core/workspace/indexReader';
import { getCaptureInsertion } from '../../domain/capture/captureLines';
import { noteTitle } from '../../domain/index/backlinks';
import { getLinkableNoteFileName } from '../../domain/markdown/noteNames';
import type { NoteLinkStyle } from '../../domain/markdown/wikiLinks';
import {
  formatMeetingHeading,
  formatMeetingLink,
  formatMeetingTime,
  listMeetingNotes,
  listMeetingSubjects,
  MeetingNote,
  MeetingPick,
  MeetingSubject,
  orderPicks,
  placeMeeting,
  planMeeting,
} from '../../domain/notes/meetings';
import { chooseTargetFolder } from './dailyNote';
import { validateExtractedNoteName } from './extractHeading';
import { fileExists } from './fs';
import { createHubNote } from './hubNote';
import { resolveSourceUri } from './navigation';
import { noteName, reportFailure } from './notify';
import { showQuickPickUntilHidden } from './prompts';
import { ensureDailyNoteWithRollover, VscodeRolloverService } from './rollover';
import { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * Deckard: Start a Meeting (docs/implementation/49-meetings-and-types.md):
 * asks what the meeting is about, offering what has been written about
 * lately, and its name, then writes its heading where it belongs and puts
 * the cursor under it. The rules are domain/notes/meetings.ts's; this asks,
 * finds or makes the notes, and writes.
 */

const TITLE = 'Deckard: Start a Meeting';

/** A row of the list: something a meeting can be about, or a line between groups. */
export interface MeetingItem extends vscode.QuickPickItem {
  /** What checking the row picks; absent on a line between groups. */
  pick?: MeetingPick;
}

/**
 * The list Start a Meeting shows: today's note first, for a meeting about
 * no one thing; the projects, people, and other subjects written about
 * lately; the notes that hold meetings; and a note of its own, for a
 * meeting that recurs.
 */
export function buildMeetingItems(subjects: readonly MeetingSubject[], notes: readonly MeetingNote[]): MeetingItem[] {
  const separator = (label: string): MeetingItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
  return [
    { label: '$(calendar) No one thing', description: 'in today\'s note', pick: { kind: 'today' } },
    ...(subjects.length > 0 ? [separator('Written about lately')] : []),
    ...subjects.map(
      ({ tag, hubPath }): MeetingItem => ({
        label: tag.label,
        description: hubPath ? `in ${noteTitle(hubPath)}` : 'in a new hub note',
        pick: { kind: 'subject', tag, hubPath },
      }),
    ),
    separator('Meeting notes'),
    ...notes.map(
      ({ filePath, title, lastDay }): MeetingItem => ({
        label: `$(note) ${title}`,
        description: `last held ${lastDay}`,
        pick: { kind: 'note', filePath },
      }),
    ),
    { label: '$(new-file) A note of its own…', description: 'for a meeting that recurs', pick: { kind: 'ownNote' } },
  ];
}

/**
 * What Enter picks: the rows checked, in the order they were checked, or
 * with none checked the row the cursor is on, so choosing a row and
 * pressing Enter starts a meeting about it as any other list would.
 */
export function readMeetingPicks(checked: readonly MeetingItem[], active: readonly MeetingItem[]): MeetingPick[] {
  const rows = checked.length > 0 ? checked : active.slice(0, 1);
  return rows.flatMap((row) => row.pick ?? []);
}

/** Asks what the meeting is about; undefined when the list is dismissed. */
function pickMeeting(items: readonly MeetingItem[]): Promise<MeetingPick[] | undefined> {
  let checked: MeetingItem[] = [];
  return showQuickPickUntilHidden<MeetingItem, MeetingPick[]>({
    configure: (pick) => {
      pick.title = TITLE;
      pick.placeholder = 'What is it about? The first you check is where its notes go, and the rest tag it';
      pick.canSelectMany = true;
      pick.matchOnDescription = true;
      pick.items = items;
      pick.onDidChangeSelection((selected) => {
        checked = orderPicks(checked, selected);
      });
    },
    accept: (pick) => readMeetingPicks(checked, pick.activeItems),
  });
}

/**
 * Asks the meeting's name. One written in a note of its own must have a
 * name a note can take; any other may have none, and is headed by its day
 * and time alone.
 */
function askMeetingName(home: MeetingPick): Thenable<string | undefined> {
  const ownNote = home.kind === 'ownNote';
  return vscode.window.showInputBox({
    title: TITLE,
    prompt: ownNote ? 'Name the meeting; its note takes the name' : 'Name the meeting, or leave it empty',
    placeHolder: ownNote ? 'Weekly staff' : 'Vendor sync',
    validateInput: (value) => (ownNote ? validateExtractedNoteName(value) : undefined),
  });
}

type MeetingIndexer = IndexReader<vscode.Uri> & Pick<IndexControl, 'refresh'>;

/** What Start a Meeting writes through: the index, the history its write is kept in, and the rollover a new daily note starts with. */
export interface MeetingServices {
  indexer: MeetingIndexer;
  history: WorkspaceWriteHistory;
  rollover: VscodeRolloverService;
}

/** Starts a meeting: asks what it is about and its name, writes its heading, and opens the note under it. */
export async function startMeeting({ indexer, history, rollover }: MeetingServices): Promise<void> {
  await indexer.ready;
  const now = Date.now();
  const index = indexer.getSnapshot();
  const picks = await pickMeeting(buildMeetingItems(listMeetingSubjects(index, now), listMeetingNotes(index, now)));
  if (!picks) {
    return;
  }
  const { home, tags } = planMeeting(picks);
  const name = await askMeetingName(home);
  if (name === undefined) {
    return;
  }
  const folder = await chooseTargetFolder();
  if (!folder) {
    return;
  }
  const homeUri = home.kind === 'today' ? undefined : await resolveHome(indexer, folder, home, name);
  if (home.kind !== 'today' && !homeUri) {
    return;
  }
  const todayUri = await ensureDailyNoteWithRollover(indexer, rollover, folder);
  const written = await writeMeeting(history, {
    heading: formatMeetingHeading({
      now,
      // A note of its own is named for the meeting, so each time it is held needs only its day.
      name: home.kind === 'ownNote' ? '' : name,
      tags,
      daily: !homeUri,
    }),
    time: formatMeetingTime(now),
    todayUri,
    homeUri,
    pathOf: (uri) => indexer.getFilePath(uri),
  });
  if (!written) {
    void reportFailure({
      outcome: `Deckard could not write the meeting into ${noteName(homeUri ?? todayUri)}, so nothing was written.`,
    });
    return;
  }
  const cursor = new vscode.Position(written.cursorLine, 0);
  await vscode.window.showTextDocument(written.document, { preview: false, selection: new vscode.Range(cursor, cursor) });
}

/** A meeting to write: its heading, and the notes it touches. */
export interface MeetingWrite {
  /** The heading without its `##`, as formatMeetingHeading makes it. */
  heading: string;
  /** The time today's link line starts with, `HH:MM`. */
  time: string;
  todayUri: vscode.Uri;
  /** The note the meeting is written in when it is not today's. */
  homeUri?: vscode.Uri;
  /** A note's path in the workspace, as links between notes are resolved. */
  pathOf(uri: vscode.Uri): string;
}

/**
 * Writes a meeting's heading at the end of its note and, when that is not
 * today's note, a line linking to it at the end of today's: one change,
 * which Deckard: Undo Last Change takes back whole. Returns the note the
 * heading is in and the line its notes begin on, or undefined when the
 * edit was refused.
 */
export async function writeMeeting(
  history: WorkspaceWriteHistory,
  { heading, time, todayUri, homeUri, pathOf }: MeetingWrite,
): Promise<{ document: vscode.TextDocument; cursorLine: number } | undefined> {
  const writtenIn = homeUri ?? todayUri;
  const document = await vscode.workspace.openTextDocument(writtenIn);
  const placed = placeMeeting(document.getText(), heading);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    writtenIn,
    new vscode.Range(placed.start.line, placed.start.character, placed.end.line, placed.end.character),
    placed.text,
  );
  if (homeUri) {
    const link = formatMeetingLink({
      heading,
      time,
      todayPath: pathOf(todayUri),
      homePath: pathOf(homeUri),
      style: readLinkStyle(todayUri),
    });
    const today = await vscode.workspace.openTextDocument(todayUri);
    const insertion = getCaptureInsertion(today.getText(), link);
    edit.insert(todayUri, new vscode.Position(insertion.line, insertion.character), insertion.text);
  }
  const written = await history.write(edit, {
    label: 'starting a meeting',
    // The heading and today's link to it are one gesture, and the note opens on what was written.
    preview: 'never',
    together: true,
  });
  return written.applied ? { document, cursorLine: placed.cursorLine } : undefined;
}

/** `deckard.links.style` for a note. */
function readLinkStyle(uri: vscode.Uri): NoteLinkStyle {
  return vscode.workspace.getConfiguration('deckard', uri).get<string>('links.style', 'wiki') === 'markdown'
    ? 'markdown'
    : 'wiki';
}

/**
 * The note a meeting is written in, other than today's: a subject's hub
 * note, made when it has none; a note that holds meetings; or a note named
 * for the meeting, made when no note has the name. Undefined, with the
 * reason said, when it cannot be found or made.
 */
async function resolveHome(
  indexer: MeetingIndexer,
  folder: vscode.WorkspaceFolder,
  home: Exclude<MeetingPick, { kind: 'today' }>,
  name: string,
): Promise<vscode.Uri | undefined> {
  if (home.kind === 'ownNote') {
    return ensureMeetingNote(indexer.getNotesFolderUri(folder), name);
  }
  if (home.kind === 'subject' && !home.hubPath) {
    return createHubNote(indexer, home.tag.key);
  }
  const filePath = home.kind === 'subject' ? (home.hubPath ?? '') : home.filePath;
  const uri = await resolveSourceUri(filePath);
  if (!uri || !(await fileExists(uri))) {
    void reportFailure({ outcome: `Deckard could not find ${filePath}, so the meeting was not started.` });
    return undefined;
  }
  return uri;
}

/** A meeting's own note in the notes folder: the one of that name, or a new one holding its title. */
async function ensureMeetingNote(notesFolderUri: vscode.Uri, name: string): Promise<vscode.Uri | undefined> {
  const fileName = getLinkableNoteFileName(name);
  if (!fileName) {
    return undefined;
  }
  const uri = vscode.Uri.joinPath(notesFolderUri, fileName);
  if (!(await fileExists(uri))) {
    await vscode.workspace.fs.createDirectory(notesFolderUri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(`# ${noteTitle(fileName)}\n\n`, 'utf8'));
  }
  return uri;
}
