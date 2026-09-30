import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { chooseTheme, ChooseThemeDeps, ThemeItem } from '../ui/commands/chooseTheme';
import { onDidChangePageChrome } from '../ui/webview/components';
import { DeckardTheme, getDeckardTheme } from '../ui/webview/themes';
import { ThemePreview } from '../ui/webview/themePreview';

const manifest = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
    contributes: Parameters<typeof chooseTheme>[0];
  }
).contributes;

/** A quick pick the test drives: move, accept, or hide. */
function fakeQuickPick() {
  const active = new vscode.EventEmitter<readonly ThemeItem[]>();
  const accept = new vscode.EventEmitter<void>();
  const hide = new vscode.EventEmitter<void>();
  const pick = {
    title: '',
    placeholder: '',
    items: [] as readonly ThemeItem[],
    activeItems: [] as readonly ThemeItem[],
    selectedItems: [] as readonly ThemeItem[],
    shown: false,
    onDidChangeActive: active.event,
    onDidAccept: accept.event,
    onDidHide: hide.event,
    show() {
      this.shown = true;
    },
    hide() {
      hide.fire();
    },
    dispose() {
      return undefined;
    },
    move(theme: DeckardTheme) {
      this.activeItems = this.items.filter((item) => item.theme === theme);
      active.fire(this.activeItems);
    },
    accept() {
      accept.fire();
    },
  };
  return pick;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(options: { visible?: boolean } = {}) {
  const pick = fakeQuickPick();
  const written: DeckardTheme[] = [];
  const opened: string[] = [];
  // Each test previews on a preview of its own, which nothing else draws with.
  const themePreview = new ThemePreview();
  const deps: ChooseThemeDeps = {
    createQuickPick: () => pick as unknown as vscode.QuickPick<ThemeItem>,
    writeTheme: async (theme) => {
      written.push(theme);
      return true;
    },
    hasVisibleDeckardPage: () => options.visible ?? true,
    openDashboard: async () => void opened.push('dashboard'),
    preview: (theme, previewOptions) => themePreview.show(theme, previewOptions),
    current: () => 'corpo',
    delay: 0,
  };
  return { pick, written, opened, deps, themePreview };
}

suite('Choose Theme', () => {
  test('lists the eight themes, described as the setting describes them, the one in use first to hand', async () => {
    const { pick, deps } = setup();
    const done = chooseTheme(manifest, deps);
    await wait(0);
    assert.strictEqual(pick.items.length, 8);
    const descriptions = manifest.configuration
      ?.map((group) => group.properties?.['deckard.theme']?.enumDescriptions)
      .find(Boolean);
    assert.deepStrictEqual(pick.items.map((item) => item.detail), descriptions);
    assert.strictEqual(pick.items.find((item) => item.theme === 'corpo')?.description, 'In use');
    assert.strictEqual(pick.activeItems[0]?.theme, 'corpo');
    assert.match(pick.placeholder, /Escape puts back Corpo\./);
    pick.hide();
    await done;
  });

  test('previews a theme as it is moved to, without writing it, and Escape puts the old one back', async () => {
    const { pick, written, deps, themePreview } = setup();
    let redraws = 0;
    const listener = onDidChangePageChrome(() => (redraws += 1), themePreview);
    try {
      const done = chooseTheme(manifest, deps);
      pick.move('cooper');
      await wait(10);
      assert.strictEqual(getDeckardTheme(themePreview), 'cooper');
      assert.ok(redraws > 0, 'the pages redraw for a preview');
      pick.hide();
      assert.strictEqual(await done, undefined);
      assert.strictEqual(getDeckardTheme(themePreview), 'corpo');
      assert.deepStrictEqual(written, []);
    } finally {
      listener.dispose();
    }
  });

  test('keeps the theme chosen, written once', async () => {
    const { pick, written, deps } = setup();
    const done = chooseTheme(manifest, deps);
    pick.move('lcars');
    pick.accept();
    assert.strictEqual(await done, 'lcars');
    assert.deepStrictEqual(written, ['lcars']);
  });

  test('opens the Dashboard first when there is no page to preview on', async () => {
    const { pick, opened, deps } = setup({ visible: false });
    const done = chooseTheme(manifest, deps);
    await wait(0);
    pick.hide();
    await done;
    assert.deepStrictEqual(opened, ['dashboard']);
  });
});
