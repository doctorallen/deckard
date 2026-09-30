/**
 * Deckard's themes by name, apart from the sheets that draw them, so what
 * only needs to name a theme, such as the preview, does not load VS Code.
 */

/** Deckard's eight themes, in the order the setting and the picker list them. */
export const deckardThemes = [
  'corpo',
  'replicant',
  'oblivion',
  'lcars',
  'synthwave',
  'tomcat',
  'fellowship',
  'cooper',
] as const;

/** One of Deckard's themes, as `deckard.theme` names it. */
export type DeckardTheme = (typeof deckardThemes)[number];

/** Each theme as a picker names it. */
export const deckardThemeNames: Readonly<Record<DeckardTheme, string>> = {
  corpo: 'Corpo',
  replicant: 'Replicant',
  oblivion: 'Oblivion',
  lcars: 'LCARS',
  synthwave: 'Synthwave',
  tomcat: 'Tomcat',
  fellowship: 'Fellowship',
  cooper: 'Cooper',
};
