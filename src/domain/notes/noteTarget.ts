/**
 * Where opening a note goes: the editor, or the note page. The reader's
 * setting picks one, and Shift on the click picks the other, so neither is
 * ever more than a modifier away.
 */

/** Where a note opens. */
export type NoteTarget = 'editor' | 'page';

/** The setting as written, read as a target: anything but `page` is the editor, the default. */
export function readNoteTarget(value: unknown): NoteTarget {
  return value === 'page' ? 'page' : 'editor';
}

/** Where a note asked for opens: where the setting says, or, with `opposite`, the other place. */
export function chooseNoteTarget(setting: NoteTarget, opposite: boolean): NoteTarget {
  if (!opposite) {
    return setting;
  }
  return setting === 'page' ? 'editor' : 'page';
}
