import * as vscode from 'vscode';

import { toFrontmatterKey } from '../../domain/markdown/frontmatter';
import type { TypeField } from '../../domain/model';
import { planFieldSave, setDraftValues, startExistingNoteDraft, type TypedNoteDraft } from '../../domain/types/typedNoteDraft';
import type { TypeIndex, TypeRow } from '../../domain/types/typeIndex';
import type { MoveTypeRowMessage, TypeBoard } from '../protocol/searchPage';
import { possessive } from '../state/fileThis';
import { describeBoardMove, moveFieldValues, planTypeBoardMove, readAxisValue, type BoardFieldChange, type WrittenAxisValue } from '../state/typeBoard';
import { frontmatterEdit, writeRowHub, type FileThisWrites } from './fileThis';
import { openResultAt } from './navigation';
import { describeRejectedEdit, noteName, reportFailure } from './notify';
import { findRowNoteType } from './typeNotes';
import type { WriteHandle } from './workspaceWrites';

/**
 * Moving a card on a type's board (docs/implementation/46-boards-and-lanes.md
 * § Moving a card): the fields its new cell's column and lane stand for,
 * written in the row's note's front matter through the field writer the
 * form and File this use, as one write with Undo. A row with no hub note
 * gets one, written at once, as File this writes it.
 */

/** What a board's moves read the index and write notes through. */
export type BoardMoveWrites = Pick<FileThisWrites, 'indexer' | 'history'>;

/**
 * Moves a card, as `message` asks, on the board the page was drawn from.
 * True when a write was made; false when nothing was, which is said when
 * it was refused, so the page draws the card back where it was.
 */
export async function moveTypeBoardRow(writes: BoardMoveWrites, board: TypeBoard | undefined, message: MoveTypeRowMessage): Promise<boolean> {
  await writes.indexer.ready;
  const types = writes.indexer.getTypeIndex();
  const row = types.row(message.rowId);
  const plan = board && row?.typeKey === message.typeKey ? planTypeBoardMove(board, message.rowId, message.from, message.to) : undefined;
  if (!row || !plan) {
    return false;
  }
  if ('refused' in plan) {
    void reportFailure({ outcome: `${plan.refused.slice(0, -1)}, so ${row.title} was not moved.`, fix: 'Change it in the notes that set it.', severity: 'warning' });
    return false;
  }
  const definition = types.registry.get(row.typeKey);
  const changes = plan.changes.flatMap((change) => {
    const field = definition?.fields.find((candidate) => candidate.key === change.field);
    return field ? [{ change, field }] : [];
  });
  if (changes.length === 0 || changes.length !== plan.changes.length) {
    return false;
  }
  const handle = row.filePath ? await writeMove({ writes, types }, { ...row, filePath: row.filePath }, changes) : await writeMoveHub(writes, row, changes);
  if (!handle) {
    return false;
  }
  handle.offerUndo(describeBoardMove(row.title, plan.changes), { guard: 'latest', done: `Put ${row.title} back.` });
  return true;
}

/** A change a move makes, with the schema's field it writes. */
interface FieldMove {
  change: BoardFieldChange;
  field: TypeField;
}

/** Says a card's field no longer holds the value it was moved from, with the note to look at. */
function reportStaleMove(row: TypeRow, move: FieldMove, filePath?: string): void {
  void reportFailure({
    outcome: `${possessive(row.title)} ${move.field.name} is not ${move.change.from.label} in its note, so it was not moved.`,
    fix: 'Another note may set it, or the note changed since the board was drawn.',
    severity: 'warning',
    ...(filePath ? { action: { title: 'Open Note', run: () => openResultAt(filePath, 1, { pin: true }) } } : {}),
  });
}

/** What a move reads its row's note with: the writes, and the type index now. */
interface MoveContext {
  writes: BoardMoveWrites;
  types: TypeIndex;
}

/** A row's note as it is now: where it is, and its text. */
interface NoteText {
  uri: vscode.Uri;
  filePath: string;
  text: string;
}

/** The values a note's text writes for a field, as written and as the board reads each. */
function readWritten({ writes, types }: MoveContext, note: NoteText, field: TypeField): WrittenAxisValue[] {
  const properties = writes.indexer.parse(note.uri, note.text).properties ?? [];
  // The last of a key written twice, as the parser reads it and the writer rewrites it.
  const property = [...properties].reverse().find((candidate) => toFrontmatterKey(candidate.name) === toFrontmatterKey(field.key));
  return (property?.values ?? []).map((value) => ({ text: value.text, id: readAxisValue(types, types.resolveValue(field.kind, value, note.filePath))?.id }));
}

/**
 * Writes a move in the row's note: each field's values as the move leaves
 * them, from what the note writes now, as one replacement of its front
 * matter, every other key and comment as written. The write's handle.
 */
async function writeMove(context: MoveContext, row: TypeRow & { filePath: string }, moves: readonly FieldMove[]): Promise<WriteHandle | undefined> {
  const { writes, types } = context;
  const filePath = row.filePath;
  const uri = writes.indexer.getUri(filePath);
  const type = findRowNoteType(types.registry, row.typeKey);
  if (!uri || !type) {
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  const current: Record<string, WrittenAxisValue[]> = {};
  const next: Record<string, string[]> = {};
  for (const move of moves) {
    current[move.field.key] = readWritten(context, { uri, filePath, text }, move.field);
    const values = moveFieldValues(current[move.field.key], move.field.kind.many, move.change.from, move.change.to);
    if (values === 'stale') {
      reportStaleMove(row, move, filePath);
      return undefined;
    }
    next[move.field.key] = values;
  }
  const original = Object.fromEntries(Object.entries(current).map(([key, values]) => [key, values.map((value) => ({ text: value.text }))]));
  const draft = Object.entries(next).reduce<TypedNoteDraft>(
    (each, [key, values]) => setDraftValues(each, key, values.map((value) => ({ text: value }))),
    startExistingNoteDraft(type, { filePath, title: row.title, content: text, values: original }),
  );
  const plan = planFieldSave(type, draft, text);
  if (plan.kind === 'refused') {
    void reportFailure({
      outcome: `${plan.name} is written in a way Deckard cannot rewrite, so ${row.title} was not moved.`,
      action: { title: 'Open Note', run: () => openResultAt(filePath, plan.line, { pin: true }) },
    });
    return undefined;
  }
  if (plan.kind !== 'edit') {
    return undefined;
  }
  // One note the reader changed on purpose, so nothing to preview.
  const result = await writes.history.write(frontmatterEdit(document, plan), { label: `Move "${row.title}"`, preview: 'never' });
  if (!result.applied) {
    void reportFailure(describeRejectedEdit(noteName(uri)));
    return undefined;
  }
  return result.handle;
}

/** A row with no hub note gets one, with the move's fields set, as File this writes it. The write's handle. */
async function writeMoveHub(writes: BoardMoveWrites, row: TypeRow, moves: readonly FieldMove[]): Promise<WriteHandle | undefined> {
  const fields: Array<{ key: string; values: string[] }> = [];
  for (const move of moves) {
    const values = moveFieldValues([], move.field.kind.many, move.change.from, move.change.to);
    if (values === 'stale') {
      reportStaleMove(row, move);
      return undefined;
    }
    fields.push({ key: move.field.key, values });
  }
  const typeNote = writes.indexer.getTypeIndex().registry.get(row.typeKey)?.filePath;
  return writeRowHub(writes, row.id, fields, {
    ...(typeNote ? { near: writes.indexer.getUri(typeNote) } : {}),
    notWritten: `${row.title} was not moved`,
    gone: () => undefined,
  });
}
