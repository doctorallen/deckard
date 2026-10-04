/**
 * A due date as the host words it, "Overdue 15 days · 2026-09-08", in the
 * parts Display's Dates preference chooses between: the state, which is
 * always drawn so an overdue date always says "Overdue"; how far off it is;
 * and the date. The page writes every part, and display.css only folds the
 * one the reader turned off into visually hidden text, so a screen reader
 * hears the whole date whichever is drawn.
 */
export interface DueParts {
  /** `Overdue`, `Due`, `Due today`, `Was due`; empty for "20 days late". */
  readonly state: string;
  /** ` 15 days`, ` in 3 days`, ` tomorrow`, or `20 days late`; empty when the wording gives none. */
  readonly distance: string;
  /** The date, or empty when the wording gives none. */
  readonly date: string;
}

/**
 * A due label's parts. The host's wordings (domain/markdown/dueWording.ts and
 * the agenda's "20 days late") are the only input; any other text is all
 * state, so it is drawn as it is.
 */
export function splitDueLabel(label: string): DueParts {
  const at = label.lastIndexOf(' · ');
  if (at < 0) {
    return { state: label, distance: '', date: '' };
  }
  const head = label.slice(0, at);
  const date = label.slice(at + 3);
  const overdue = /^(overdue)( .+)$/i.exec(head);
  if (overdue) {
    return { state: overdue[1], distance: overdue[2], date };
  }
  const due = /^(due)( tomorrow| in .+)$/i.exec(head);
  if (due) {
    return { state: due[1], distance: due[2], date };
  }
  if (/ late$/.test(head)) {
    return { state: '', distance: head, date };
  }
  return { state: head, distance: '', date };
}
