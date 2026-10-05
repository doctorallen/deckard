import type { WorkspaceIndex } from '../model';

/** How many checkbox lines in the index hold a mark that is not a task's. */
export function countOtherCheckboxes(index: WorkspaceIndex): number {
  let lines = 0;
  index.files.forEach((file) => {
    lines += file.otherCheckboxes ?? 0;
  });
  return lines;
}
