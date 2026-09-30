/**
 * A shim that keeps `import … from './taskMetadataSuggestions'` compiling
 * while the refactor moves importers to the provider's new home,
 * `src/ui/providers/taskMetadataSuggestions.ts`. Phase 7 deletes it.
 */
export * from '../providers/taskMetadataSuggestions';
