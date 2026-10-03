import * as vscode from 'vscode';

import { reportError } from '../../shared/timing';

/**
 * Wraps a command's handler so every command fails the same way.
 *
 * - A `vscode.CancellationError` is the reader backing out, so it is
 *   swallowed and the command returns `undefined`.
 * - Any other exception is written to Deckard's log with the command's id,
 *   then thrown on, so VS Code reports it exactly as it did before the
 *   wrapper: its own notification when the palette or a keybinding ran the
 *   command, and a rejected `executeCommand` when code did. It shows no
 *   message of its own, so whatever a command showed before the wrapper,
 *   it shows now, and nothing more.
 *
 * What the handler returns is returned as it is: a value synchronously, a
 * promise as a promise that settles the same way, apart from the two cases
 * above.
 */
export function runCommand<A extends unknown[], R>(
  id: string,
  handler: (...args: A) => R,
): (...args: A) => R | undefined {
  return (...args: A) => {
    try {
      const result = handler(...args);
      return isThenable(result)
        ? (result.then(undefined, (error: unknown) => settleFailure(id, error)) as R)
        : result;
    } catch (error) {
      return settleFailure(id, error);
    }
  };
}

/** Registers a command whose handler runs through {@link runCommand}. */
export function registerCommand<A extends unknown[], R>(
  id: string,
  handler: (...args: A) => R,
): vscode.Disposable {
  return vscode.commands.registerCommand(id, runCommand(id, handler));
}

/** Swallows a cancellation; logs anything else and throws it on. */
function settleFailure(id: string, error: unknown): undefined {
  if (error instanceof vscode.CancellationError) {
    return undefined;
  }
  reportError(`The command ${id} failed`, error);
  throw error;
}

/** Whether a handler's result is a promise, or anything else with a `then`. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
