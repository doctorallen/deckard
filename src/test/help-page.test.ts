import * as assert from 'assert';

import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';

import { HelpPanel } from '../ui/webview/help';
import { getHelpHtml, HelpManifest } from '../ui/webview/helpHtml';
import { openWebviewPage } from './webviewPage';

suite('Help page', () => {
  const extensionUri = vscode.Uri.file('/tmp/deckard-extension');
  const manifest = (
    JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { contributes: HelpManifest }
  ).contributes;
  const webview = { cspSource: 'vscode-webview://deckard', asWebviewUri: (uri: vscode.Uri) => uri };
  const helpHtml = (platform: NodeJS.Platform = 'darwin') =>
    getHelpHtml(webview, extensionUri, manifest, { platform });

  test('names only commands Deckard contributes', () => {
    const titles = new Set(manifest.commands?.map((command) => command.title));
    const named = [...getHelpHtml(webview, extensionUri).matchAll(/<code>Deckard: ([^<]+)<\/code>/g)].map(
      (match) => match[1],
    );
    assert.ok(named.length > 20, 'Help names the commands it describes');
    assert.deepStrictEqual(named.filter((title) => !titles.has(title)), []);
  });

  test('a command it names runs from Help, with its shortcut beside it', () => {
    const page = openWebviewPage(helpHtml());
    try {
      const find = page
        .findAll('article button.command-link[data-command="deckard.searchWorkspace"]')
        .find((button) => button.textContent === 'Deckard: Find in Notes');
      assert.ok(find, 'the prose names Find as a button');
      assert.strictEqual(find.nextElementSibling?.textContent, 'Cmd+Shift+Alt+F');
      (find as HTMLElement).click();
      assert.ok(
        page.findAll('#commands td button.command-link').some((button) => button.textContent === 'Find in Notes'),
        'and so does the commands table',
      );
      assert.deepStrictEqual(page.lastPosted('runCommand'), {
        type: 'runCommand',
        command: 'deckard.searchWorkspace',
      });
      assert.strictEqual(
        page.findAll('article button.command-link[data-command="deckard.editTask"]').length,
        0,
        'Edit Task acts on the note in the editor, so Help names it as code',
      );
      assert.ok(page.findAll('article code').some((code) => code.textContent === 'Deckard: Edit Task'));
    } finally {
      page.dispose();
    }
    assert.match(helpHtml('linux'), /<kbd class="shortcut">Ctrl\+Shift\+Alt\+F<\/kbd>/);
  });

  test('its host runs only what Help may run', async () => {
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const original = commands.executeCommand;
    const ran: string[] = [];
    commands.executeCommand = async (id: string) => void ran.push(id);
    const help = new HelpPanel(extensionUri, manifest);
    try {
      await help.handle({ type: 'runCommand', command: 'deckard.editTask' });
      await help.handle({ type: 'runCommand', command: 'workbench.action.quit' });
      await help.handle({ type: 'runCommand', command: 'deckard.showStats' });
    } finally {
      commands.executeCommand = original;
      help.dispose();
    }
    assert.deepStrictEqual(ran, ['deckard.showStats']);
  });

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
      webview: {
        options: {} as vscode.WebviewOptions,
        html: '',
        cspSource: 'x',
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
        postMessage: async () => true,
      },
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
