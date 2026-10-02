import * as assert from 'assert';

import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/** A page running the shared tag menu, with its exports on `window.shared`. */
function menuPage(): WebviewPage {
  const bundle = bundleShared(['tagMenu']);
  return openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><script>${bundle}</script></body></html>`);
}

type Helpers = Record<string, (...args: unknown[]) => unknown>;

/**
 * The keys of the menu a right-click opens on a tag or a card: the arrows,
 * Home, and End walk it, as they walk a board card's menu.
 */
suite('The shared context menu answers the keys a menu does', () => {
  let page: WebviewPage | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  test('the arrows walk its items round the ends, and Home and End go to the first and last', () => {
    page = menuPage();
    const shown = page;
    const shared = (shown.window as unknown as { shared: Helpers }).shared;
    shared.openContextMenu({ preventDefault: () => undefined, clientX: 10, clientY: 10 }, [
      { action: 'rename-tag', label: 'Rename tag' },
      { action: 'park-tag', label: 'Park tag' },
      { action: 'pin-note', label: 'Pin to Home' },
    ]);
    const items = shown.findAll('#tag-context-menu [data-context-action]');
    const focused = () => shown.document.activeElement?.getAttribute('data-context-action');
    /** A key pressed where focus is; whether the menu took it. */
    const press = (key: string): boolean => {
      const event = new shown.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      (shown.document.activeElement as Element).dispatchEvent(event);
      return event.defaultPrevented;
    };
    assert.strictEqual(shown.document.activeElement, items[0]);
    assert.strictEqual(press('ArrowDown'), true, 'the menu takes the key');
    assert.strictEqual(focused(), 'park-tag');
    press('End');
    assert.strictEqual(focused(), 'pin-note');
    press('ArrowDown');
    assert.strictEqual(focused(), 'rename-tag', 'down from the last goes round to the first');
    press('ArrowUp');
    assert.strictEqual(focused(), 'pin-note', 'and up from the first to the last');
    press('Home');
    assert.strictEqual(focused(), 'rename-tag');
  });
});
