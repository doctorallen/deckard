import * as vscode from 'vscode';

/** The command the problems lens runs when a note has more than one kind of problem. */
export const PICK_NOTE_PROBLEM_FIX_COMMAND = 'deckard.pickNoteProblemFix';

/** One row of the list: a fix, and the command that makes it. */
export interface NoteProblemFixChoice {
  label: string;
  detail?: string;
  command: vscode.Command;
}

/**
 * Lists the fixes the problems lens offers, such as Create missing notes and
 * Link mentions, and runs the one chosen. Choices that are not fixes are
 * left out, since a lens's arguments reach the command as they were given.
 */
export async function pickNoteProblemFix(choices: unknown): Promise<void> {
  const fixes = Array.isArray(choices) ? choices.filter(isChoice) : [];
  if (fixes.length === 0) {
    return;
  }
  const picked = await vscode.window.showQuickPick(fixes, {
    title: 'Fix this note',
    placeHolder: 'Choose what to do about its links and mentions',
  });
  if (picked) {
    await vscode.commands.executeCommand(picked.command.command, ...(picked.command.arguments ?? []));
  }
}

function isChoice(value: unknown): value is NoteProblemFixChoice {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { label, command } = value as Partial<NoteProblemFixChoice>;
  return typeof label === 'string' && typeof command === 'object' && command !== null && typeof command.command === 'string';
}
