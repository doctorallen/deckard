import * as vscode from 'vscode';

import { TagInfo, TagReference, WorkspaceIndex } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { getExtractedNoteFileName } from './extractHeading';
import { resolveSourceUri } from './navigation';

/**
 * Names a hub note after what it describes: `#project/skybridge-signal`
 * becomes `Skybridge Signal`, and `@dana` becomes `Dana`.
 */
export function getHubNoteName(tag: TagReference): string {
  const name = tag.label.slice(1).split('/').pop() ?? '';
  const title = name
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .trim();
  return title || 'Hub';
}

/**
 * The smallest note that is a hub: front matter naming the tag, then a title.
 */
export function createHubNoteContent(tag: TagReference, title: string): string {
  return `---\ndescribes: ${getDescribesValue(tag)}\n---\n# ${title}\n\n`;
}

/**
 * Creates a hub note for a tag in the notes folder and opens it. A note that
 * already has the name is never overwritten.
 */
export async function createHubNote(
  indexer: WorkspaceIndexer,
  tagKey: string,
): Promise<vscode.Uri | undefined> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const tag = index.tags.get(tagKey);
  if (!tag) {
    void vscode.window.showWarningMessage(
      `Deckard could not find the tag: ${tagKey}`,
    );
    return undefined;
  }
  const workspaceFolder = await findWorkspaceFolder(index, tag);
  if (!workspaceFolder) {
    void vscode.window.showWarningMessage(
      'Open a workspace folder to create a hub note.',
    );
    return undefined;
  }

  const title = getHubNoteName(tag);
  const fileName = getExtractedNoteFileName(title) ?? 'Hub.md';
  const notesFolderUri = indexer.getNotesFolderUri(workspaceFolder);
  const noteUri = vscode.Uri.joinPath(notesFolderUri, fileName);
  if (await exists(noteUri)) {
    const choice = await vscode.window.showWarningMessage(
      `${fileName} already exists. Add "describes: ${getDescribesValue(tag)}" to its front matter to make it the hub note for ${tag.label}.`,
      'Open',
    );
    if (choice === 'Open') {
      await vscode.window.showTextDocument(noteUri, { preview: false });
    }
    return undefined;
  }

  await vscode.workspace.fs.createDirectory(notesFolderUri);
  await vscode.workspace.fs.writeFile(
    noteUri,
    Buffer.from(createHubNoteContent(tag, title), 'utf8'),
  );
  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

/**
 * A `#` tag is written bare because YAML reads an unquoted `#` as the start of
 * a comment; a person is quoted so its marker survives.
 */
function getDescribesValue(tag: TagReference): string {
  return tag.key.startsWith('#') ? tag.label.slice(1) : `"${tag.label}"`;
}

/** The workspace folder that already holds the tag's notes, or the first one. */
async function findWorkspaceFolder(
  index: WorkspaceIndex,
  tag: TagInfo,
): Promise<vscode.WorkspaceFolder | undefined> {
  const filePath =
    tag.filePaths[0] ??
    index.sections.get(tag.sectionIds[0] ?? '')?.filePath ??
    index.tasks.get(tag.taskIds[0] ?? '')?.filePath;
  const uri = filePath ? await resolveSourceUri(filePath) : undefined;
  return (
    (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined) ??
    vscode.workspace.workspaceFolders?.[0]
  );
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
