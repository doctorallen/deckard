import * as vscode from 'vscode';

import type { PageCommands, Services } from '../../../composition/services';
import { setOutlineFollowCursor } from '../../views/outlineTree';
import { registerCommand } from '../runCommand';
import { settingTarget, writeSetting } from '../settings';
import { listToggleCommands, SETTING_TOGGLES, ToggleCommand } from './settingToggles';

/**
 * The paired commands that turn one setting on and off, one registration
 * per row of SETTING_TOGGLES: the Calendar's day panel, weekends, and
 * repeats, the Outline following the cursor, and zen.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  context.subscriptions.push(
    ...listToggleCommands(SETTING_TOGGLES).map((command) =>
      registerCommand(command.id, () => writeToggle(command, services.pageCommands)),
    ),
  );
}

/**
 * Writes one toggle's value where its target says. The `user` and
 * `folder-where-set` targets are the Outline's and zen's own setters, which
 * also set the context key the palette reads; each serves its one setting.
 */
function writeToggle(command: ToggleCommand, pageCommands: PageCommands): Promise<unknown> {
  switch (command.target) {
    case 'where-set':
      return writeSetting(command.setting, command.value, settingTarget(command.setting));
    case 'user':
      return setOutlineFollowCursor(command.value);
    case 'folder-where-set':
      return pageCommands.setZenMode(command.value);
  }
}
