import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { noteTitle } from '../../domain/index/backlinks';
import { renameFrontmatterKey, setFrontmatterField, type FrontmatterFieldEdit } from '../../domain/types/frontmatterWriter';
import { getTypeIndex } from '../../domain/types/typeIndex';
import { planFieldRename, planOptionRename, rewriteTableCell, type SchemaCellEdit } from '../../domain/types/typeRenames';
import { resolveSourceUri } from './navigation';
import { reportFailure } from './notify';
import type { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * Rename field everywhere… and Rename option everywhere…, from a type's
 * search page (docs/implementation/30-databases.md § Types as searches,
 * § Writes): the new name asked for, then one edit per row note that
 * writes the field or holds the option, and the type's schema table, shown
 * in the refactor preview and written as one change Undo Last Change takes
 * back.
 */

/** What a rename reads and writes through. */
export interface TypeRenameWrites {
  indexer: Pick<IndexReader<vscode.Uri>, 'getSnapshot' | 'getUri'>;
  history: WorkspaceWriteHistory;
}

/** Asks a field's new name, and renames it in every row note and the type's table. True when written. */
export async function renameTypeField(writes: TypeRenameWrites, typeKey: string, fieldKey: string): Promise<boolean> {
  const type = getTypeIndex(writes.indexer.getSnapshot()).registry.get(typeKey);
  const field = type?.fields.find((each) => each.key === fieldKey.toLowerCase());
  if (!type || !field) {
    void vscode.window.showInformationMessage(`${type?.name ?? typeKey} has no field called ${fieldKey} now.`);
    return false;
  }
  const name = await vscode.window.showInputBox({
    title: `Rename ${field.name} everywhere`,
    prompt: `The new name for ${type.name}'s ${field.name}: the key in each of its notes' front matter, and its row in ${type.name}'s table`,
    value: field.name,
    valueSelection: [0, field.name.length],
    validateInput: (value) => {
      const planned = planFieldRename(writes.indexer.getSnapshot(), typeKey, fieldKey, value);
      return 'error' in planned && value.trim() !== field.name ? planned.error : undefined;
    },
  });
  if (name === undefined || name.trim() === field.name) {
    return false;
  }
  const plan = planFieldRename(writes.indexer.getSnapshot(), typeKey, fieldKey, name);
  if ('error' in plan) {
    void vscode.window.showInformationMessage(plan.error);
    return false;
  }
  return writeRename(writes, {
    label: `Rename ${plan.name} to ${plan.newName}`,
    notes: plan.notes.map((filePath) => ({ filePath, edit: (content: string) => renameFrontmatterKey(content, plan.key, plan.newName) })),
    schema: plan.schema,
    what: `${plan.name} is now ${plan.newName}`,
  });
}

/** Asks an option's new name, and renames it in every row note that holds it and in the type's table. True when written. */
export async function renameTypeOption(writes: TypeRenameWrites, typeKey: string, fieldKey: string, option: string): Promise<boolean> {
  const first = planOptionRename(writes.indexer.getSnapshot(), { typeKey, field: fieldKey, option }, `${option}~`);
  if ('error' in first) {
    void vscode.window.showInformationMessage(first.error);
    return false;
  }
  const current = first.option;
  const renamed = await vscode.window.showInputBox({
    title: `Rename ${current} everywhere`,
    prompt: `The new name for the option ${current}, written in every note that holds it and in the type's table`,
    value: current,
    valueSelection: [0, current.length],
    validateInput: (value) => {
      const planned = planOptionRename(writes.indexer.getSnapshot(), { typeKey, field: fieldKey, option: current }, value);
      return 'error' in planned && value.trim() !== current ? planned.error : undefined;
    },
  });
  if (renamed === undefined || renamed.trim() === current) {
    return false;
  }
  const plan = planOptionRename(writes.indexer.getSnapshot(), { typeKey, field: fieldKey, option: current }, renamed);
  if ('error' in plan) {
    void vscode.window.showInformationMessage(plan.error);
    return false;
  }
  return writeRename(writes, {
    label: `Rename ${plan.option} to ${plan.newOption}`,
    notes: plan.notes.map(({ filePath, write }) => ({ filePath, edit: (content: string) => setFrontmatterField(content, plan.key, write) })),
    schema: plan.schema,
    what: `${plan.option} is now ${plan.newOption}`,
  });
}

/** A rename as the notes are to take it: each note's edit, the schema's cell, and what to call it. */
interface RenameWrite {
  label: string;
  notes: Array<{ filePath: string; edit: (content: string) => FrontmatterFieldEdit }>;
  schema: SchemaCellEdit;
  /** What changed, for the message after: `lead is now manager`. */
  what: string;
}

/**
 * Makes each note's edit against its document as it is now, and the
 * schema's, as one write shown in the refactor preview. A note whose key
 * cannot be rewritten safely is left out and named after.
 */
async function writeRename(writes: TypeRenameWrites, rename: RenameWrite): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  const skipped = await addNoteEdits(writes, rename, edit);
  await addSchemaEdit(writes, rename.schema, edit);
  if (edit.size === 0) {
    return false;
  }
  const result = await writes.history.write(edit, { label: rename.label, preview: 'always' });
  if (!result.applied) {
    void reportFailure({ outcome: `VS Code did not accept the change, so nothing was renamed.` });
    return false;
  }
  const left = skipped.length
    ? ` ${skipped.map((title) => `"${title}"`).join(', ')} ${skipped.length === 1 ? 'is' : 'are'} written in a way Deckard cannot rewrite safely, so ${skipped.length === 1 ? 'it keeps' : 'they keep'} the old name.`
    : '';
  result.handle.offerUndo(`${rename.what}.${left}`, { guard: 'latest', done: 'Put the old name back.' });
  return true;
}

/** Adds each note's edit, made against its document as it is now; the titles of the notes left alone. */
async function addNoteEdits(writes: TypeRenameWrites, rename: RenameWrite, edit: vscode.WorkspaceEdit): Promise<string[]> {
  const skipped: string[] = [];
  for (const note of rename.notes) {
    const uri = await findUri(writes, note.filePath);
    const document = uri ? await vscode.workspace.openTextDocument(uri) : undefined;
    const change = document ? note.edit(document.getText()) : undefined;
    if (!document || !uri || !change || change.kind === 'refused') {
      skipped.push(noteTitle(note.filePath));
      continue;
    }
    if (change.kind === 'edit') {
      const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      edit.replace(
        uri,
        new vscode.Range(new vscode.Position(change.start, 0), new vscode.Position(change.start + change.deleted, 0)),
        change.lines.map((line) => `${line}${eol}`).join(''),
      );
    }
  }
  return skipped;
}

/** Adds the schema table's cell, rewritten in its line as the type's note holds it now. */
async function addSchemaEdit(writes: TypeRenameWrites, schema: SchemaCellEdit, edit: vscode.WorkspaceEdit): Promise<void> {
  const uri = await findUri(writes, schema.filePath);
  if (!uri) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const at = schema.line - 1;
  if (at < 0 || at >= document.lineCount) {
    return;
  }
  const line = document.lineAt(at).text;
  const next = rewriteTableCell(line, schema.cell, schema.text);
  if (next !== line) {
    edit.replace(uri, document.lineAt(at).range, next);
  }
}

/** A note's URI, by the index, or by its path in the workspace. */
async function findUri(writes: TypeRenameWrites, filePath: string): Promise<vscode.Uri | undefined> {
  return writes.indexer.getUri(filePath) ?? (await resolveSourceUri(filePath));
}
