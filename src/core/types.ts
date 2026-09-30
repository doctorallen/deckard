/**
 * A shim that keeps `import … from './types'` compiling while the
 * refactor moves importers to the types' new homes. Phase 7 deletes it.
 *
 * - The domain model (notes, sections, tasks, tags, entities, the workspace
 *   index, the query shapes) is in `src/domain/model`.
 * - The persisted preferences, and the page view state they store, are in
 *   `src/domain/model/preferences.ts`.
 * - Each page's snapshot and messages are in `src/ui/protocol/<page>.ts`,
 *   and what several pages share is in `src/ui/protocol/shared.ts`.
 */
export type * from '../domain/model';
export { DEFAULT_SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZES } from '../domain/model/preferences';
export type * from '../ui/protocol';
