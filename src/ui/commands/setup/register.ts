import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import type { IndexRoles } from '../../../core/workspace/indexReader';
import { checkSetup } from '../checkSetup';
import { chooseDisplay } from '../chooseDisplay';
import { chooseTheme, createChooseThemeDeps } from '../chooseTheme';
import { createSampleWorkspace } from '../sampleWorkspace';
import { registerCommand } from '../runCommand';
import { chooseScope, pauseHere, resumeHere } from '../writeTarget';
import { readEditorPreset } from '../../../domain/editor/editorPresets';

/**
 * Setup and diagnostics: Show Log, Check Setup, the sample workspace, Choose
 * Theme…, Choose Display…, the walkthrough, Reindex Workspace, and pausing Deckard in a
 * workspace.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { log, indexer, scanner, themePreview } = services;
  context.subscriptions.push(
    registerCommand('deckard.showLog', () => log.show()),
    registerCommand('deckard.checkSetup', () =>
      checkSetup(indexer, scanner),
    ),
    registerCommand('deckard.createSampleWorkspace', () =>
      createSampleWorkspace(context, 'story'),
    ),
    registerCommand('deckard.createWorkSample', () =>
      createSampleWorkspace(context, 'work'),
    ),
    registerCommand('deckard.chooseTheme', () =>
      chooseTheme(context.extension.packageJSON.contributes, createChooseThemeDeps(themePreview)),
    ),
    registerCommand('deckard.chooseDisplay', () => chooseDisplay(themePreview)),
    registerCommand('deckard.openWalkthrough', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#deckard.gettingStarted`,
        false,
      ),
    ),
    registerCommand('deckard.reindexWorkspace', () => reindexWorkspace(indexer)),
    registerCommand('deckard.pauseHere', () => pauseHere()),
    registerCommand('deckard.resumeHere', () => resumeHere()),
    registerCommand('deckard.chooseScope', () => chooseScope()),
    registerCommand('deckard.chooseEditorPreset', () => chooseEditorPreset()),
  );
}

/** Reads and parses every note again, then says what it found. */
async function reindexWorkspace(indexer: IndexRoles<vscode.Uri>): Promise<void> {
  await indexer.ready;
  // Asked for by hand, every note is read and parsed again.
  await indexer.refresh({ reuse: 'none' });
  // Reindexing looked like it did nothing: a status-bar spinner, then
  // silence. Asked for by hand, it says what it found.
  const index = indexer.getSnapshot();
  /** A count and its noun, with an s for any count but one. */
  const plural = (count: number, noun: string): string =>
    `${count} ${noun}${count === 1 ? '' : 's'}`;
  void vscode.window.showInformationMessage(
    `Deckard indexed ${plural(index.files.size, 'file')}: ${plural(
      index.sections.size,
      'note',
    )}, ${plural(index.tasks.size, 'task')}, and ${plural(
      index.tags.size,
      'tag',
    )}.`,
  );
}

/** Deckard: Choose Editor Preset…, writing the choice to the user's settings. */
async function chooseEditorPreset(): Promise<void> {
  const current = readEditorPreset(vscode.workspace.getConfiguration('deckard.editor').get('preset'));
  const choices = [
    { label: 'Full', detail: 'Everything: link counts, task hints, breadcrumbs, mention lenses, previews.', value: 'full' },
    { label: 'Tasks', detail: 'Task hints, steps, dependencies, and problem reports; no link counts or breadcrumbs.', value: 'tasks' },
    { label: 'Writing', detail: 'A quiet page: the / menu, hover previews, and broken links and rules only.', value: 'writing' },
  ].map((choice) => ({ ...choice, description: choice.value === current ? 'current' : '' }));
  const picked = await vscode.window.showQuickPick(choices, {
    title: 'What Deckard draws in the editor',
    placeHolder: 'An editor setting you changed yourself still wins',
  });
  if (picked) {
    await vscode.workspace.getConfiguration('deckard.editor').update('preset', picked.value, vscode.ConfigurationTarget.Global);
  }
}
