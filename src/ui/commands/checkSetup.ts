import * as vscode from 'vscode';

import { getPersonMarker } from '../../core/markdown/parser';
import { matchesPerson } from '../../core/query/queryEvaluator';
import { UnreadableNote, WorkspaceIndex } from '../../core/types';
import { WorkspaceScanner } from '../../core/workspace/scanner';

/**
 * Deckard has forty-nine settings, and the effect of most of them is that
 * something is silently not there: a notes folder that does not exist, an
 * exclude pattern that swallows the notes, a `deckard.me` that matches no
 * one. Reading the settings does not say which. This does: it looks at what
 * the settings resolve to in this workspace, what the last scan found and
 * kept out, and what the index holds, and writes it up with what to do.
 */

export interface SetupFolder {
  name: string;
  /** The `deckard.notesFolder` setting, or empty for the whole folder. */
  notesFolder: string;
  notesFolderExists: boolean;
  /** The `deckard.templatesFolder` setting, or undefined when turned off. */
  templatesFolder?: string;
  templatesFolderExists?: boolean;
}

export interface SetupFacts {
  folders: SetupFolder[];
  scan: { found: number; templates: number; excluded: number; read: number };
  excludePatterns: string[];
  unreadable: UnreadableNote[];
  indexed: { files: number; sections: number; tasks: number; tags: number };
  personMarker: string;
  /** How many people the index knows, by the marker or `#person/`. */
  people: number;
  me?: string;
  /** Whether `me` names a person the index has. */
  meIsKnown: boolean;
  tasksForMe: number;
}

interface SetupIndexer {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  getUnreadable(): UnreadableNote[];
  getLastScan(): SetupFacts['scan'];
}

export async function collectSetupFacts(
  indexer: SetupIndexer,
  scanner = new WorkspaceScanner(),
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
      notesFolderExists: await exists(scanner.getNotesFolderUri(folder)),
      ...(templatesUri
        ? {
            templatesFolder: configuration.get<string>('templatesFolder', 'templates'),
            templatesFolderExists: await exists(templatesUri),
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
    personMarker,
    people,
    me,
    meIsKnown,
    tasksForMe,
  };
}

/** The report, as Markdown a reader can read, copy, or paste into an issue. */
export function buildSetupReport(facts: SetupFacts, now = new Date()): string {
  const lines: string[] = [];
  const ok = (text: string) => lines.push(`- ✅ ${text}`);
  const warn = (text: string, fix: string) => lines.push(`- ⚠️ ${text}\n  - **What to do:** ${fix}`);

  lines.push('# Deckard setup check', '', `_${now.toLocaleString()}_`, '', '## Where the notes are', '');
  if (facts.folders.length === 0) {
    warn('No folder is open, so there is nothing to index.', 'Open the folder that holds your notes.');
  }
  for (const folder of facts.folders) {
    const scope = folder.notesFolder ? `\`${folder.notesFolder}\` inside \`${folder.name}\`` : `all of \`${folder.name}\``;
    if (folder.notesFolderExists) {
      ok(`Notes are read from ${scope}.`);
    } else {
      warn(
        `\`deckard.notesFolder\` is \`${folder.notesFolder}\`, but that folder does not exist in \`${folder.name}\`, so nothing is indexed.`,
        'Fix the setting, or create the folder.',
      );
    }
    if (folder.templatesFolder !== undefined) {
      if (folder.templatesFolderExists) {
        ok(`Templates come from \`${folder.templatesFolder}\`, which is kept out of the index.`);
      } else {
        lines.push(`- ℹ️ \`deckard.templatesFolder\` is \`${folder.templatesFolder}\`, which does not exist yet. That is fine until you want templates.`);
      }
    }
  }

  lines.push('', '## What the last scan found', '');
  const { scan } = facts;
  if (scan.found === 0 && facts.folders.length > 0) {
    warn('The scan found no Markdown files at all.', 'Check that your notes end in `.md` and sit under the notes folder above.');
  } else {
    ok(`${scan.found} Markdown ${scan.found === 1 ? 'file' : 'files'} found; ${scan.read} read into the index.`);
  }
  if (scan.templates > 0) {
    lines.push(`- ℹ️ ${scan.templates} kept out as templates.`);
  }
  if (scan.excluded > 0) {
    const share = scan.found > 0 ? Math.round((scan.excluded / scan.found) * 100) : 0;
    const text = `${scan.excluded} of ${scan.found} kept out by exclude patterns (${facts.excludePatterns.map((p) => `\`${p}\``).join(', ') || '`files.exclude`'}).`;
    if (share >= 50) {
      warn(`${text} That is ${share}% of what was found.`, 'Check `deckard.exclude` and `files.exclude`; one pattern may be wider than meant.');
    } else {
      lines.push(`- ℹ️ ${text}`);
    }
  }
  if (facts.unreadable.length > 0) {
    warn(
      `${facts.unreadable.length} ${facts.unreadable.length === 1 ? 'note' : 'notes'} could not be read, so ${facts.unreadable.length === 1 ? 'it is' : 'they are'} not indexed:\n${facts.unreadable.map((note) => `  - \`${note.filePath}\` — ${note.reason}`).join('\n')}`,
      'Fix the cause, then run `Deckard: Reindex Workspace`.',
    );
  } else if (scan.read > 0) {
    ok('Every note that was found was read.');
  }

  lines.push('', '## What the index holds', '');
  const { indexed } = facts;
  ok(`${indexed.files} notes, ${indexed.sections} entries, ${indexed.tasks} tasks, ${indexed.tags} tags.`);
  if (indexed.files > 0 && indexed.tags === 0) {
    warn('No tags were found in any note.', 'Write a tag such as `#project/atlas` on a heading or a task. Tags are what Deckard connects notes by.');
  }

  lines.push('', '## People', '');
  if (facts.people === 0) {
    lines.push(`- ℹ️ No people yet. Write \`${facts.personMarker}name\` or \`#person/name\` to name one.`);
  } else {
    ok(`${facts.people} ${facts.people === 1 ? 'person' : 'people'} known, written with \`${facts.personMarker}\` or \`#person/\`.`);
  }
  if (!facts.me) {
    lines.push('- ℹ️ `deckard.me` is not set, so `is:mine` finds only tasks for nobody in particular. Set it to your own tag, such as `@ren-kade`, to find yours by name.');
  } else if (facts.meIsKnown) {
    ok(`\`deckard.me\` is \`${facts.me}\`, a person the index knows; ${facts.tasksForMe} ${facts.tasksForMe === 1 ? 'task is' : 'tasks are'} for you by name.`);
  } else {
    warn(
      `\`deckard.me\` is \`${facts.me}\`, but no note names that person.`,
      `Check the spelling against how you write yourself in notes, or the marker: people are written with \`${facts.personMarker}\` here.`,
    );
  }
  return lines.join('\n') + '\n';
}

export async function checkSetup(indexer: SetupIndexer): Promise<void> {
  const facts = await collectSetupFacts(indexer);
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildSetupReport(facts),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
