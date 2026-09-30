import { WorkspaceIndex } from '../core/types';

/**
 * An index as plain data: every map as its entries in order, associations
 * read in full, and the build time left out. Order is compared, not sorted
 * away.
 */
export function normalizeIndex(index: WorkspaceIndex): unknown {
  const associations = index.tagAssociations
    ? [...index.tagAssociations.entries()].map(([key, list]) => [
        key,
        list.map((association) => {
          // The direct pass left its working set of units on each one.
          const copy: Record<string, unknown> = { ...association };
          delete copy.sourceUnitIds;
          return copy;
        }),
      ])
    : [];
  return {
    files: [...index.files.entries()],
    sections: [...index.sections.entries()],
    tasks: [...index.tasks.entries()],
    tags: [...index.tags.entries()],
    entities: [...index.entities.entries()],
    tagAssociations: associations,
  };
}
