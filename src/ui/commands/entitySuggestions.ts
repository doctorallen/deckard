/**
 * A shim that keeps `import … from './entitySuggestions'` compiling while
 * the refactor moves importers to the provider's new home,
 * `src/ui/providers/entitySuggestions.ts`. Phase 7 deletes it.
 */
export * from '../providers/entitySuggestions';
