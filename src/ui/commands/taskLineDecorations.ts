/**
 * A shim that keeps `import … from './taskLineDecorations'` compiling while
 * the refactor moves importers to the decorations' new home,
 * `src/ui/providers/taskLineDecorations.ts`. Phase 7 deletes it.
 */
export * from '../providers/taskLineDecorations';
