import * as vscode from 'vscode';
import { fileExists } from './fs';

import { getPersonMarker } from '../../domain/markdown/parser';
import { matchesPerson } from '../../domain/query/queryEvaluator';
import { pluralize } from '../../shared/text';
import { WorkspaceScanner } from '../../core/workspace/scanner';
import { UnreadableNote, WorkspaceIndex } from '../../domain/model';

/**
 * Deckard has forty-nine settings, and the effect of most of them is that
 * something is silently not there: a notes folder that does not exist, an
 * exclude pattern that swallows the notes, a `deckard.me` that matches no
 * one. Reading the settings does not say which. This does: it looks at what
 * the settings resolve to in this workspace, what the last scan found and
 * kept out, and what the index holds, and writes it up with what to do.
 */

/** One workspace folder's notes and templates folders, and whether each exists. */
export interface SetupFolder {
  name: string;
  /** The `deckard.notesFolder` setting, or empty for the whole folder. */
  notesFolder: string;
  notesFolderExists: boolean;
  /** The `deckard.templatesFolder` setting, or undefined when turned off. */
  templatesFolder?: string;
  templatesFolderExists?: boolean;
}

/**
 * Everything the setup report is written from, gathered first so the report
 * itself is a pure function a test can check line by line.
 */
export interface SetupFacts {
  folders: SetupFolder[];
  scan: { found: number; templates: number; excluded: number; read: number };
  excludePatterns: string[];
  unreadable: UnreadableNote[];
  indexed: { files: number; sections: number; tasks: number; tags: number };
  /** How many notes their folder parks, and how many a front-matter tag does. */
  parked?: { byFolder: number; byTag: number };
  personMarker: string;
  /** How many people the index knows, by the marker or `#person/`. */
  people: number;
  me?: string;
  /** Whether `me` names a person the index has. */
  meIsKnown: boolean;
  tasksForMe: number;
}

/** The indexer's view a setup check reads, once the first index is ready. */
interface SetupIndexer {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  getUnreadable(): UnreadableNote[];
  getLastScan(): SetupFacts['scan'];
}

/**
 * Reads what the settings resolve to in each workspace folder, what the last
 * scan found, and what the index holds, waiting for the index first.
 */
export async function collectSetupFacts(
  indexer: SetupIndexer,
  scanner: WorkspaceScanner<vscode.Uri>,
): Promise<SetupFacts> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const configuration = vscode.workspace.getConfiguration('deckard');
  const folders: SetupFolder[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const notesFolder = scanner.getNotesFolder(folder);
    const templatesUri = scanner.getTemplatesFolderUri(folder);
    folders.push({
      name: folder.name,
      notesFolder,
      notesFolderExists: await fileExists(scanner.getNotesFolderUri(folder)),
      ...(templatesUri
        ? {
            templatesFolder: configuration.get<string>('templatesFolder', 'templates'),
            templatesFolderExists: await fileExists(templatesUri),
          }
        : {}),
    });
  }
  const excludeSetting = configuration.get<Record<string, unknown>>('exclude', {});
  const personMarker = getPersonMarker(configuration.get<unknown>('personMarker'));
  const me = configuration.get<string>('me', '').trim() || undefined;
  const people = [...index.entities.values()].filter((entity) => entity.kind === 'person').length;
  const meIsKnown = Boolean(
    me && [...index.tags.keys()].some((tagKey) => matchesPerson(me, tagKey)),
  );
  const tasksForMe = me
    ? [...index.tasks.values()].filter((task) => matchesPerson(me, task.assignee)).length
    : 0;
  return {
    folders,
    scan: indexer.getLastScan(),
    excludePatterns: Object.entries(excludeSetting)
      .filter(([, on]) => on === true)
      .map(([pattern]) => pattern),
    unreadable: indexer.getUnreadable(),
    indexed: {
      files: index.files.size,
      sections: index.sections.size,
      tasks: index.tasks.size,
      tags: index.tags.size,
    },
    ...(index.parked
      ? { parked: { byFolder: index.parked.byFolder, byTag: index.parked.byTag } }
      : {}),
    personMarker,
    people,
    me,
    meIsKnown,
    tasksForMe,
  };
}

/** A line saying something is set up as it should be. */
function ok(text: string): string {
  return `- ✅ ${text}`;
}

/** A line saying something is wrong, with what to do about it. */
function warn(text: string, fix: string): string {
  return `- ⚠️ ${text}\n  - **What to do:** ${fix}`;
}

/** The report, as Markdown a reader can read, copy, or paste into an issue. */
export function buildSetupReport(facts: SetupFacts, now = new Date()): string {
  const lines: string[] = [
    '# Deckard setup check', '', `_${now.toLocaleString()}_`,
    ...foldersSection(facts),
    ...scanSection(facts),
    ...indexSection(facts),
    ...peopleSection(facts),
  ];
  return lines.join('\n') + '\n';
}

/** Where the notes are read from in each folder, and where templates come from. */
function foldersSection(facts: SetupFacts): string[] {
  const lines = ['', '## Where the notes are', ''];
  if (facts.folders.length === 0) {
    lines.push(warn('No folder is open, so there is nothing to index.', 'Open the folder that holds your notes.'));
  }
  for (const folder of facts.folders) {
    const scope = folder.notesFolder ? `\`${folder.notesFolder}\` inside \`${folder.name}\`` : `all of \`${folder.name}\``;
    lines.push(
      folder.notesFolderExists
        ? ok(`Notes are read from ${scope}.`)
        : warn(
            `\`deckard.notesFolder\` is \`${folder.notesFolder}\`, but that folder does not exist in \`${folder.name}\`, so nothing is indexed.`,
            'Fix the setting, or create the folder.',
          ),
    );
    if (folder.templatesFolder === undefined) {
      continue;
    }
    lines.push(
      folder.templatesFolderExists
        ? ok(`Templates come from \`${folder.templatesFolder}\`, which is kept out of the index.`)
        : `- ℹ️ \`deckard.templatesFolder\` is \`${folder.templatesFolder}\`, which does not exist yet. That is fine until you want templates.`,
    );
  }
  return lines;
}

/** What the last scan found, what it kept out and why, and what it could not read. */
function scanSection(facts: SetupFacts): string[] {
  const lines = ['', '## What the last scan found', ''];
  const { scan } = facts;
  lines.push(
    scan.found === 0 && facts.folders.length > 0
      ? warn('The scan found no Markdown files at all.', 'Check that your notes end in `.md` and sit under the notes folder above.')
      : ok(`${scan.found} Markdown ${scan.found === 1 ? 'file' : 'files'} found; ${scan.read} read into the index.`),
  );
  if (scan.templates > 0) {
    lines.push(`- ℹ️ ${scan.templates} kept out as templates.`);
  }
  if (scan.excluded > 0) {
    lines.push(describeExcluded(facts));
  }
  if (facts.unreadable.length > 0) {
    lines.push(warn(
      `${pluralize(facts.unreadable.length, 'note')} could not be read, so ${facts.unreadable.length === 1 ? 'it is' : 'they are'} not indexed:\n${facts.unreadable.map((note) => `  - \`${note.filePath}\` — ${note.reason}`).join('\n')}`,
      'Fix the cause, then run `Deckard: Reindex Workspace`.',
    ));
  } else if (scan.read > 0) {
    lines.push(ok('Every note that was found was read.'));
  }
  return lines;
}

/**
 * How many notes exclude patterns kept out, and by which; a warning when that
 * is half or more of what was found, as one pattern is likely wider than meant.
 */
function describeExcluded(facts: SetupFacts): string {
  const { scan } = facts;
  const share = scan.found > 0 ? Math.round((scan.excluded / scan.found) * 100) : 0;
  const text = `${scan.excluded} of ${scan.found} kept out by exclude patterns (${facts.excludePatterns.map((p) => `\`${p}\``).join(', ') || '`files.exclude` or `search.exclude`'}).`;
  if (share >= 50) {
    return warn(`${text} That is ${share}% of what was found.`, 'Check `deckard.exclude`, `files.exclude`, and `search.exclude`; one pattern may be wider than meant.');
  }
  return `- ℹ️ ${text}`;
}

/** What the index holds, whether it has any tags, and how much of it is parked. */
function indexSection(facts: SetupFacts): string[] {
  const lines = ['', '## What the index holds', ''];
  const { indexed } = facts;
  lines.push(ok(`${indexed.files} notes, ${indexed.sections} entries, ${indexed.tasks} tasks, ${indexed.tags} tags.`));
  if (indexed.files > 0 && indexed.tags === 0) {
    lines.push(warn('No tags were found in any note.', 'Write a tag such as `#project/atlas` on a heading or a task. Tags are what Deckard connects notes by.'));
  }
  const parked = (facts.parked?.byFolder ?? 0) + (facts.parked?.byTag ?? 0);
  if (parked > 0 && parked >= indexed.files) {
    lines.push(warn(
      'Every note is parked, so the Tasks view and Related Notes will be empty.',
      'Check `deckard.parked.folders`.',
    ));
  } else if (parked > 0) {
    lines.push(
      `- ℹ️ ${parked} ${parked === 1 ? 'note is' : 'notes are'} parked: ${facts.parked?.byFolder ?? 0} by \`deckard.parked.folders\` and ${facts.parked?.byTag ?? 0} by a parked tag.`,
    );
  }
  return lines;
}

/** How many people the index knows, and whether `deckard.me` names one of them. */
function peopleSection(facts: SetupFacts): string[] {
  const lines = ['', '## People', ''];
  lines.push(
    facts.people === 0
      ? `- ℹ️ No people yet. Write \`${facts.personMarker}name\` or \`#person/name\` to name one.`
      : ok(`${facts.people} ${facts.people === 1 ? 'person' : 'people'} known, written with \`${facts.personMarker}\` or \`#person/\`.`),
    describeMe(facts),
  );
  return lines;
}

/** Whether `deckard.me` is set, and whether it names a person the index has. */
function describeMe(facts: SetupFacts): string {
  if (!facts.me) {
    return '- ℹ️ `deckard.me` is not set, so `is:mine` finds only tasks for nobody in particular. Set it to your own tag, such as `@ren-kade`, to find yours by name.';
  }
  if (facts.meIsKnown) {
    return ok(`\`deckard.me\` is \`${facts.me}\`, a person the index knows; ${facts.tasksForMe} ${facts.tasksForMe === 1 ? 'task is' : 'tasks are'} for you by name.`);
  }
  return warn(
    `\`deckard.me\` is \`${facts.me}\`, but no note names that person.`,
    `Check the spelling against how you write yourself in notes, or the marker: people are written with \`${facts.personMarker}\` here.`,
  );
}

/** Opens the setup report as an unsaved Markdown preview tab, once the index is ready. */
export async function checkSetup(
  indexer: SetupIndexer,
  scanner: WorkspaceScanner<vscode.Uri>,
): Promise<void> {
  const facts = await collectSetupFacts(indexer, scanner);
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildSetupReport(facts),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}
