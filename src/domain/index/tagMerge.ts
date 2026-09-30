import type { TagInfo, WorkspaceIndex } from '../model';

/**
 * What merging one tag into another does to the index.
 */
export interface TagMergeSummary {
  source: TagInfo;
  target: TagInfo;
  /** Entries the kept tag will have, counted the way the index counts them. */
  mergedCount: number;
  /** Entries that already carry both tags. */
  sharedCount: number;
}

/**
 * Counts what merging one tag into another leaves the kept tag with.
 * Undefined when either tag is not indexed, or both are the same tag, since
 * then there is no merge to describe.
 */
export function summarizeTagMerge(
  index: WorkspaceIndex,
  sourceKey: string,
  targetKey: string,
): TagMergeSummary | undefined {
  const source = index.tags.get(sourceKey);
  const target = index.tags.get(targetKey);
  if (!source || !target || source.key === target.key) {
    return undefined;
  }

  const sectionIds = new Set([...source.sectionIds, ...target.sectionIds]);
  const taskIds = new Set([...source.taskIds, ...target.taskIds]);
  const filePaths = new Set([...source.filePaths, ...target.filePaths]);
  // A task inside a tagged section is already counted by its section.
  const standaloneTasks = [...taskIds].filter((taskId) => {
    const task = index.tasks.get(taskId);
    return !task?.sectionId || !sectionIds.has(task.sectionId);
  });
  const mergedCount =
    sectionIds.size + standaloneTasks.length + filePaths.size;

  return {
    source,
    target,
    mergedCount,
    sharedCount: Math.max(0, source.count + target.count - mergedCount),
  };
}
