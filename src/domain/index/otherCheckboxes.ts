import type { WorkspaceIndex } from '../model';
import { UNKNOWN_STATUS_NAME } from '../tasks/taskStatuses';

/** How many checkbox lines in the index are text: a `nonTask` status's lines. */
export function countOtherCheckboxes(index: WorkspaceIndex): number {
  let lines = 0;
  index.files.forEach((file) => {
    lines += file.otherCheckboxes ?? 0;
  });
  return lines;
}

/**
 * The tasks whose checkbox holds a character no status names, read as to
 * do: how many, and the characters, in the order first found.
 */
export function countUnknownStatuses(index: WorkspaceIndex): { count: number; symbols: string[] } {
  let count = 0;
  const symbols = new Set<string>();
  index.tasks.forEach((task) => {
    if (task.status.name !== UNKNOWN_STATUS_NAME) {
      return;
    }
    count += 1;
    symbols.add(task.status.symbol);
  });
  return { count, symbols: [...symbols] };
}
