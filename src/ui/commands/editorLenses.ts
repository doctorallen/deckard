/**
 * A shim that keeps `import … from './editorLenses'` compiling while the
 * refactor moves importers to the provider's new home,
 * `src/ui/providers/editorLenses.ts`. Phase 7 deletes it.
 */
export * from '../providers/editorLenses';
