import type { ParsedFile, WorkspaceIndex } from '../model';

/**
 * Notes whose index paths changed because the workspace's folders did, with
 * the new ids of their tasks and headings. Each map runs from the old key to
 * the new one.
 */
export interface RekeyedNotes {
  files: Map<string, string>;
  tasks: Map<string, string>;
  sections: Map<string, string>;
}

/**
 * The notes `previous` and `next` hold under different paths only because
 * a workspace folder was added or removed: with one folder, a note's path
 * is relative to it, as `plan.md`; with more, it starts with the folder's
 * key, as `notes/plan.md`. A task's or heading's id is worked out from its
 * note's path, so each changes with it.
 *
 * A note is matched when its path gained or lost exactly one leading folder
 * and its text is the same; a note with more than one such match is left
 * out, since which one it became cannot be told. Its tasks and headings are
 * matched in order, when it has as many of each as before.
 */
export function findRekeyedNotes(
  previous: Pick<WorkspaceIndex, 'files'>,
  next: Pick<WorkspaceIndex, 'files'>,
): RekeyedNotes {
  const rekeyed: RekeyedNotes = { files: new Map(), tasks: new Map(), sections: new Map() };
  const added = [...next.files.keys()].filter((filePath) => !previous.files.has(filePath));
  if (added.length === 0) {
    return rekeyed;
  }
  const addedPaths = new Set(added);
  // A note whose path gained a folder is found by the rest of its path.
  const byRest = new Map<string, string[]>();
  added.forEach((filePath) => {
    const rest = withoutFirstFolder(filePath);
    if (rest !== undefined) {
      byRest.set(rest, [...(byRest.get(rest) ?? []), filePath]);
    }
  });
  previous.files.forEach((oldFile, oldPath) => {
    if (next.files.has(oldPath)) {
      return;
    }
    const rest = withoutFirstFolder(oldPath);
    const candidates = [
      ...(byRest.get(oldPath) ?? []),
      ...(rest !== undefined && addedPaths.has(rest) ? [rest] : []),
    ];
    const matches = candidates.filter((newPath) => next.files.get(newPath)?.content === oldFile.content);
    const newFile = matches.length === 1 ? next.files.get(matches[0]) : undefined;
    if (newFile) {
      carryNote(oldFile, newFile, rekeyed);
    }
  });
  return rekeyed;
}

/** Records one note's new path, and its tasks' and headings' new ids, matched in order. */
function carryNote(oldFile: ParsedFile, newFile: ParsedFile, rekeyed: RekeyedNotes): void {
  rekeyed.files.set(oldFile.filePath, newFile.filePath);
  if (oldFile.tasks.length === newFile.tasks.length) {
    oldFile.tasks.forEach((task, index) => rekeyed.tasks.set(task.id, newFile.tasks[index].id));
  }
  if (oldFile.sections.length === newFile.sections.length) {
    oldFile.sections.forEach((section, index) =>
      rekeyed.sections.set(section.id, newFile.sections[index].id),
    );
  }
}

/** An index path less its first folder: `plan.md` for `notes/plan.md`; undefined for a path with no folder. */
function withoutFirstFolder(filePath: string): string | undefined {
  const slash = filePath.indexOf('/');
  return slash < 0 ? undefined : filePath.slice(slash + 1);
}
