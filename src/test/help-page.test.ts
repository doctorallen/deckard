import * as assert from 'assert';

import * as vscode from 'vscode';

import { HelpPanel } from '../ui/webview/help';
import { getHelpHtml } from '../ui/webview/helpHtml';
import { openWebviewPage } from './webviewPage';

suite('Help page', () => {
  const extensionUri = vscode.Uri.file('/tmp/deckard-extension');

  test('its rail marks the section being read', () => {
    const page = openWebviewPage(
      getHelpHtml(
        { cspSource: 'vscode-webview://deckard', asWebviewUri: (uri: vscode.Uri) => uri },
        extensionUri,
      ),
    );
    try {
      assert.strictEqual(page.findAll('nav a[aria-current="location"]').length, 1);
    } finally {
      page.dispose();
    }
  });

  test('its panel runs scripts, made new or restored', async () => {
    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window.createWebviewPanel;
    const made: unknown[] = [];
    const fakePanel = () => ({
      webview: { options: {} as vscode.WebviewOptions, html: '', cspSource: 'x', asWebviewUri: (uri: vscode.Uri) => uri },
      onDidDispose: () => ({ dispose: () => undefined }),
      reveal: () => undefined,
      dispose: () => undefined,
    });
    window.createWebviewPanel = (...args: unknown[]) => {
      made.push(args[3]);
      return fakePanel();
    };
    assert.strictEqual(window.createWebviewPanel === original, false, 'the panel can be stood in for');
    const help = new HelpPanel(extensionUri);
    const restoredHelp = new HelpPanel(extensionUri);
    try {
      help.show();
      assert.strictEqual((made[0] as vscode.WebviewPanelOptions & vscode.WebviewOptions).enableScripts, true);

      const restored = fakePanel();
      await restoredHelp.restore(restored as unknown as vscode.WebviewPanel);
      assert.strictEqual(restored.webview.options.enableScripts, true);
    } finally {
      window.createWebviewPanel = original;
      help.dispose();
      restoredHelp.dispose();
    }
  });
});
