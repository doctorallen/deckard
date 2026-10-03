import * as vscode from 'vscode';

/** How `showQuickPickUntilHidden` sets up its pick and reads the answer. */
export interface QuickPickUntilHidden<T extends vscode.QuickPickItem, R> {
  /** Sets the title, items, and anything else the pick needs before it shows. */
  configure(pick: vscode.QuickPick<T>): void;
  /** The answer Enter gives, read from the pick as it is pressed; undefined for none. */
  accept(pick: vscode.QuickPick<T>): R | undefined;
  /**
   * Keeps the pick open when Enter gives no answer, as on a row that only
   * heads others, instead of closing it with none.
   */
  readonly stayOpenWithoutAnswer?: boolean;
}

/**
 * Shows a QuickPick and settles with the answer Enter gave once it is
 * hidden, whether by Enter, Escape, or focus moving away, and disposes it
 * then. It exists because `showQuickPick` cannot set a pick's active row or
 * read what was typed, and every hand-built pick needs the same wiring: the
 * answer is kept on Enter and delivered on hide, so Escape after Enter
 * cannot lose it, and the promise settles exactly once.
 */
export function showQuickPickUntilHidden<T extends vscode.QuickPickItem, R>(
  options: QuickPickUntilHidden<T, R>,
): Promise<R | undefined> {
  const pick = vscode.window.createQuickPick<T>();
  options.configure(pick);
  return new Promise((resolve) => {
    let answer: R | undefined;
    pick.onDidAccept(() => {
      answer = options.accept(pick);
      if (answer !== undefined || !options.stayOpenWithoutAnswer) {
        pick.hide();
      }
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve(answer);
    });
    pick.show();
  });
}
