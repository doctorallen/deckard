/**
 * The domain model: what the user's notes are made of, as the index holds
 * them, and the query language's shapes. Nothing here knows about VS Code,
 * the disk, or a page.
 */
export type * from './notes';
export type * from './query';
export type * from './relatedNotes';
export type * from './tags';
export type * from './tasks';
export type * from './workspaceIndex';
export * from './preferences';
