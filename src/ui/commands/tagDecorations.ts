/**
 * A shim that keeps `import … from './tagDecorations'` compiling while the
 * refactor moves importers to the decorations' new home. Phase 7 deletes it.
 *
 * - The decorations, tag links, and hovers are in `src/ui/providers/tagDecorations.ts`.
 * - The tagged entries the band and hovers cover are in `src/domain/markdown/taggedEntries.ts`.
 */
export * from '../providers/tagDecorations';
export {
  collectTaggedEntries,
  findBandEntry,
} from '../../domain/markdown/taggedEntries';
export type { EditorEntry } from '../../domain/markdown/taggedEntries';
