/**
 * Editor presets: what Deckard draws in the editor, chosen as one of three
 * rather than as fifteen switches.
 *
 * Each `deckard.editor.*` switch still works, and one set by hand, at any
 * scope, wins over the preset; the preset decides only the switches left
 * alone.
 */

/** Every `deckard.editor.*` switch a preset decides, by the name after `deckard.editor.`. */
export const EDITOR_TOGGLES = [
  'referenceCounts',
  'hoverPreviews',
  'linkDiagnostics',
  'taskDependencies',
  'dailyNoteActions',
  'linkProblems',
  'embedProblems',
  'unlinkedMentions',
  'slashMenu',
  'stepProgress',
  'breadcrumbs',
  'hubProgress',
  'dimTaskMetadata',
  'taskDueHints',
  'repeatDiagnostics',
] as const;

/** One of those switches. */
export type EditorToggle = (typeof EDITOR_TOGGLES)[number];

/**
 * `full`, everything, as Deckard has always drawn it; `tasks`, what helps
 * with tasks and what reports a problem; `writing`, a quiet page that still
 * reports a broken link or rule and keeps the / menu and hover previews.
 */
export type EditorPreset = 'full' | 'tasks' | 'writing';

/** What each preset leaves off; everything else is on. */
const OFF_IN: Readonly<Record<EditorPreset, ReadonlySet<EditorToggle>>> = {
  full: new Set(),
  tasks: new Set(['referenceCounts', 'unlinkedMentions', 'breadcrumbs']),
  writing: new Set(['referenceCounts', 'unlinkedMentions', 'breadcrumbs', 'taskDependencies', 'dailyNoteActions', 'stepProgress', 'hubProgress', 'taskDueHints']),
};

/** A preset as the setting holds it; anything unknown reads as `full`. */
export function readEditorPreset(value: unknown): EditorPreset {
  return value === 'tasks' || value === 'writing' ? value : 'full';
}

/** Whether a switch is on: as set by hand when it was, otherwise as the preset says. */
export function isEditorToggleOn(toggle: EditorToggle, preset: EditorPreset, setByHand: boolean | undefined): boolean {
  return setByHand ?? !OFF_IN[preset].has(toggle);
}
