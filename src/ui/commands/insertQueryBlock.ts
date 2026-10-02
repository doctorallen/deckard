import * as vscode from 'vscode';

import { PreferencesReader } from '../../core/storage/preferences';
import { formatQueryBlock } from '../state/queryBlockState';
import { getSavedFilterQuery } from '../state/dashboardState';

/** One row of the picker: a saved or recent search, or what is typed. */
interface QueryBlockItem extends vscode.QuickPickItem {
  query?: string;
}

/**
 * The searches the picker offers: saved ones under their names, then recent
 * ones, newest first, without repeating a saved one.
 */
export function listQueryBlockItems(preferences: PersistedQueries): QueryBlockItem[] {
  const saved = preferences.savedFilters.map((filter) => ({
    label: filter.name,
    description: getSavedFilterQuery(filter),
    query: getSavedFilterQuery(filter),
  }));
  const savedQueries = new Set(saved.map((item) => item.query.trim()));
  const recent = (preferences.recentQueries ?? [])
    .map((query) => query.trim())
    .filter((query, position, all) => query && !savedQueries.has(query) && all.indexOf(query) === position)
    .map((query) => ({ label: query, query }));
  return [
    ...(saved.length ? [{ label: 'Saved searches', kind: vscode.QuickPickItemKind.Separator }] : []),
    ...saved,
    ...(recent.length ? [{ label: 'Recent searches', kind: vscode.QuickPickItemKind.Separator }] : []),
    ...recent,
  ];
}

type PersistedQueries = Pick<PreferencesReader['value'], 'savedFilters' | 'recentQueries'>;

/**
 * Where a block goes at the cursor, and the text written there: on its own
 * lines with a blank line either side, and the cursor after the fence.
 */
export function placeQueryBlock(
  document: { lineCount: number; lineAt(line: number): { text: string } },
  line: number,
  block: string,
): { line: number; text: string; endsAt: number } {
  const blank = (at: number): boolean => at < 0 || at >= document.lineCount || !document.lineAt(at).text.trim();
  // A block goes on a blank line where the cursor is, or on the line after
  // the one the cursor is writing on.
  const at = blank(line) ? line : line + 1;
  const before = blank(at - 1) ? '' : '\n';
  const body = block.endsWith('\n') ? block : `${block}\n`;
  const after = blank(line) || blank(at) ? '' : '\n';
  const blockLines = body.split('\n').length - 1;
  // The cursor goes below the closing fence, not inside the block, so the
  // reader keeps writing the note without first leaving the block.
  return { line: at, text: `${before}${body}${after}`, endsAt: at + (before ? 1 : 0) + blockLines };
}

/**
 * `Deckard: Insert Query Block…`: writes a live query block of a saved or
 * recent search, or of one typed, at the cursor, in one edit, so one Undo
 * takes it back.
 */
export async function insertQueryBlock(preferences: Pick<PreferencesReader, 'value'>): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Open a note to insert a query block into it.');
    return;
  }
  const listed = listQueryBlockItems(preferences.value);
  const picker = vscode.window.createQuickPick<QueryBlockItem>();
  picker.title = 'Insert a query block';
  picker.placeholder = 'A saved or recent search, or type one';
  picker.matchOnDescription = true;
  picker.items = listed;
  picker.onDidChangeValue((value) => {
    const typed = value.trim();
    picker.items = typed
      ? [{ label: `Insert a block for "${typed}"`, query: typed, alwaysShow: true }, ...listed]
      : listed;
  });
  const chosen = await new Promise<QueryBlockItem | undefined>((resolve) => {
    picker.onDidAccept(() => resolve(picker.selectedItems[0]));
    picker.onDidHide(() => resolve(undefined));
    picker.show();
  });
  picker.dispose();
  if (!chosen?.query) {
    return;
  }
  await writeQueryBlock(editor, chosen.query);
}

/** Writes a block of `query` at the editor's cursor, in one edit. */
export async function writeQueryBlock(editor: vscode.TextEditor, query: string): Promise<boolean> {
  const placed = placeQueryBlock(editor.document, editor.selection.active.line, formatQueryBlock(query));
  const position =
    placed.line >= editor.document.lineCount
      ? editor.document.lineAt(editor.document.lineCount - 1).range.end
      : new vscode.Position(placed.line, 0);
  const text = placed.line >= editor.document.lineCount ? `\n${placed.text}` : placed.text;
  const done = await editor.edit((edit) => edit.insert(position, text));
  if (done) {
    const cursor = new vscode.Position(Math.min(placed.endsAt, editor.document.lineCount - 1), 0);
    editor.selection = new vscode.Selection(cursor, cursor);
  }
  return done;
}
