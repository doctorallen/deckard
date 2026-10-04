import * as vscode from 'vscode';

import { changedScaleSettings, DISPLAY_LEVELS, type DisplayLevel } from '../state/displayLevel';
import { customizeDisplay, readDisplayLevel, readScaleSettings, setDisplayChoice, useStepValues } from './displaySettings';

/**
 * Choose Display…: the three steps, each shown on the open pages as it is
 * moved through, as Choose Theme… shows a theme; then, when the reader has
 * set any of the settings a step moves, a way to put the step's values back;
 * then Customize… and the editor's own presets. Nothing is written until a
 * step is kept; Escape puts back the step that was in use.
 */

/** The steps' names and what each draws. */
const STEPS: Readonly<Record<DisplayLevel, { label: string; detail: string }>> = {
  full: { label: 'Full', detail: 'Every theme as it is drawn' },
  quiet: { label: 'Quiet', detail: "Each theme's decoration and the lines that teach off" },
  zen: { label: 'Zen', detail: 'Also compact: what Zen mode drew' },
};

/** A picker row: a step, or one of the links under them. */
export interface DisplayItem extends vscode.QuickPickItem {
  readonly level?: DisplayLevel;
  readonly run?: () => Thenable<unknown>;
}

/** The preview the steps are shown on: the one every page draws with. */
export interface DisplayPreviewTarget {
  readonly level: DisplayLevel | undefined;
  showLevel(level: DisplayLevel | undefined, options?: { silent?: boolean }): void;
}

/** The rows: the steps, the one in use marked, then what the reader changed, then the links. */
export function createDisplayItems(current: DisplayLevel, changed: number): DisplayItem[] {
  const name = STEPS[current].label;
  const inUse = changed ? `In use · ${changed} changed` : 'In use';
  const steps: DisplayItem[] = DISPLAY_LEVELS.map((level) => ({
    label: STEPS[level].label,
    description: level === current ? inUse : undefined,
    detail: STEPS[level].detail,
    level,
  }));
  const reset: DisplayItem[] = changed
    ? [
        { label: 'Changed by you', kind: vscode.QuickPickItemKind.Separator },
        { label: `Use ${name}'s values`, description: `Undo ${changed} ${changed === 1 ? 'change' : 'changes'}`, run: () => useStepValues() },
      ]
    : [];
  return [
    ...steps,
    ...reset,
    { label: 'More', kind: vscode.QuickPickItemKind.Separator },
    { label: 'Customize…', description: 'Each Display setting, in Settings', run: () => customizeDisplay() },
    { label: 'Editor: Choose Editor Preset…', description: 'What Deckard draws in notes', run: () => vscode.commands.executeCommand('deckard.chooseEditorPreset') },
  ];
}

/** Runs Choose Display…, and returns the step kept, if one was. */
export function chooseDisplay(preview: DisplayPreviewTarget): Promise<DisplayLevel | undefined> {
  const original = readDisplayLevel();
  const items = createDisplayItems(original, changedScaleSettings(readScaleSettings()).length);
  const pick = vscode.window.createQuickPick<DisplayItem>();
  pick.title = 'Deckard display';
  pick.placeholder = `How much should Deckard draw? Move through the steps to preview them; Escape keeps ${STEPS[original].label}.`;
  pick.items = items;
  pick.activeItems = items.filter((item) => item.level === original);
  return new Promise((resolve) => {
    let kept: DisplayLevel | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (level: DisplayLevel | undefined): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (!level) {
        return;
      }
      timer = setTimeout(() => preview.showLevel(level === original ? undefined : level), 120);
    };
    const disposables = [
      pick.onDidChangeActive((active) => schedule(active[0]?.level)),
      pick.onDidAccept(async () => {
        schedule(undefined);
        const item = pick.activeItems[0];
        pick.hide();
        if (item?.run) {
          preview.showLevel(undefined);
          await item.run();
          return;
        }
        kept = item?.level;
        if (kept && kept !== original) {
          await setDisplayChoice('level', kept);
          // The pages already show it; the setting's own change redraws them.
          preview.showLevel(undefined, { silent: true });
        } else {
          preview.showLevel(undefined);
        }
      }),
      pick.onDidHide(() => {
        schedule(undefined);
        if (kept === undefined) {
          preview.showLevel(undefined);
        }
        disposables.forEach((disposable) => disposable.dispose());
        pick.dispose();
        resolve(kept);
      }),
    ];
    pick.show();
  });
}
