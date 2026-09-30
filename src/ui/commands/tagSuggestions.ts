/**
 * A shim that keeps `import … from './tagSuggestions'` compiling while the
 * refactor moves importers to the provider's new home. Phase 7 deletes it.
 *
 * - The completion provider is in `src/ui/providers/tagSuggestions.ts`.
 * - Reading the tag at the cursor is in `src/domain/markdown/completionContext.ts`.
 */
export * from '../providers/tagSuggestions';
export { getTagCompletionContext } from '../../domain/markdown/completionContext';
