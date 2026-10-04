import * as assert from 'assert';

import * as vscode from 'vscode';

import { createSessionToken, createTaskToggleHref, readTaskToggleLink } from '../ui/preview/previewTaskLinks';

suite('Query block checkbox links in VS Code', () => {
  test('a link read back the way VS Code hands it to the handler still asks for the toggle', () => {
    const token = createSessionToken();
    const href = createTaskToggleHref('vscode://esperinnovations.deckard-notes', { taskId: 'task-b1msng-tjudor', completed: false, token });
    const uri = vscode.Uri.parse(href);
    assert.deepStrictEqual(readTaskToggleLink(uri.path, uri.query, token), {
      kind: 'toggle',
      request: { taskId: 'task-b1msng-tjudor', completed: false, token },
    });
    // What toString() writes escapes every = and &, which the handler used to read.
    const rewritten = vscode.Uri.parse(uri.toString());
    assert.deepStrictEqual(readTaskToggleLink(rewritten.path, rewritten.query, token).kind, 'toggle');
  });
});
