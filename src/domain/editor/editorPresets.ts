/**
 * Editor presets: what Deckard draws in the editor, chosen as one of four
 * rather than as fifteen switches.
 *
 * Each `deckard.editor.*` switch still works, and one set by hand, at any
 * scope, wins over the preset; the preset decides only the switches left
 * alone. So that Settings never shows a switch as on while the preset turns
 * it off, and Off turns every one off, no switch has a default in the
 * manifest, and only its value set by hand is read
 * (ui/providers/editorToggles.ts).
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
 * reports a broken link, embed or rule and keeps the / menu, hover previews
 * and faint task details; `off`, none of it, so only a switch set by hand
 * draws anything.
 */
export type EditorPreset = 'full' | 'tasks' | 'writing' | 'off';

/** What each preset leaves off; everything else is on. */
const OFF_IN: Readonly<Record<EditorPreset, ReadonlySet<EditorToggle>>> = {
  full: new Set(),
  tasks: new Set(['referenceCounts', 'unlinkedMentions', 'breadcrumbs']),
  writing: new Set(['referenceCounts', 'unlinkedMentions', 'breadcrumbs', 'taskDependencies', 'dailyNoteActions', 'stepProgress', 'hubProgress', 'taskDueHints']),
  off: new Set(EDITOR_TOGGLES),
};

/** A preset as the setting holds it; anything unknown reads as `full`. */
export function readEditorPreset(value: unknown): EditorPreset {
  return value === 'tasks' || value === 'writing' || value === 'off' ? value : 'full';
}

/** Whether a switch is on: as set by hand when it was, otherwise as the preset says. */
export function isEditorToggleOn(toggle: EditorToggle, preset: EditorPreset, setByHand: boolean | undefined): boolean {
  return setByHand ?? !OFF_IN[preset].has(toggle);
}
