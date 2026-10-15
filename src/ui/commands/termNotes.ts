import * as vscode from 'vscode';

import { isTermShape } from '../../domain/terms/terms';
import { openTypeNoteForm } from './typeNoteForm';
import type { TypeWrites } from './typeNotes';

/**
 * Make a term note, from a term's hover, and Define…, from Stats' Terms
 * (docs/implementation/42-terms.md): New Note from Type…'s form for a Term,
 * its title and `term:` the term, and, from an inline definition, its
 * words as the note's first paragraph. A workspace with no Term type still
 * gets the form, for a note `type: term` with a `term:` field, which
 * Deckard reads as a term note either way.
 */
export async function makeTermNote(writes: TypeWrites, term: string, definition?: string): Promise<vscode.Uri | undefined> {
  const written = term.trim().toUpperCase();
  if (!isTermShape(written)) {
    return undefined;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return openTypeNoteForm(writes, {
    typeKey: 'term',
    start: { title: written, values: { term: written }, ...(definition?.trim() ? { body: definition.trim() } : {}) },
    ...(active ? { near: active } : {}),
  });
}
