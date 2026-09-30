/**
 * A shim that keeps `import … from './editorReferences'` compiling while the
 * refactor moves importers to the provider's new home,
 * `src/ui/providers/editorReferences.ts`. Phase 7 deletes it.
 */
export * from '../providers/editorReferences';
