/**
 * A shim that keeps `import … from './linkSuggestions'` compiling while the
 * refactor moves importers to the provider's new home. Phase 7 deletes it.
 *
 * - The completion and link provider is in `src/ui/providers/linkSuggestions.ts`.
 * - Reading the link being typed is in `src/domain/markdown/completionContext.ts`.
 * - Resolving a note's complete links is in `src/domain/index/wikiLinkTargets.ts`.
 */
export * from '../providers/linkSuggestions';
export {
  getBlockCompletionContext,
  getHeadingCompletionContext,
  getWikiLinkCompletionContext,
} from '../../domain/markdown/completionContext';
export { findWikiLinkTargets } from '../../domain/index/wikiLinkTargets';
