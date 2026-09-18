import * as vscode from 'vscode';

/**
 * Quiets the editor's own background work before any test runs.
 *
 * VS Code keeps a local history copy of every file that is edited, written
 * into the test profile's user-data directory. Tests edit notes in temporary
 * folders and then delete the folders, so the copy is often chasing a file
 * that has already gone: the run fills with
 *
 *   ENOENT: no such file or directory, copyfile '/tmp/deckard-capture-…'
 *
 * and, on a loaded machine, the extension host stalls behind that work for
 * long enough that an ordinary test waiting on a configuration change or a
 * file read passes Mocha's timeout. The history is of no use to a test run,
 * so it is turned off for the whole of one.
 *
 * A root hook, so it applies whichever suite the runner reaches first.
 */
suiteSetup(async () => {
  await vscode.workspace
    .getConfiguration('workbench.localHistory')
    .update('enabled', false, vscode.ConfigurationTarget.Global);
});
