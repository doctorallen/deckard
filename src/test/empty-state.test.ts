import * as assert from 'assert';

import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The one component every empty place draws through
 * (src/webview/shared/emptyState.tsx): a state line that always shows, a
 * line that teaches, which Zen's help step hides, and at most one next
 * step. Each place keeps its own words, so the component is held here and
 * not each place that uses it.
 */
suite('Empty state', () => {
  let core: WebviewPage;
  suiteSetup(() => {
    core = openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><script>${bundleShared(['emptyState'])}</script></body></html>`);
  });
  suiteTeardown(() => {
    core.dispose();
  });

  type Helpers = Record<string, (...args: unknown[]) => unknown>;
  const shared = () => (core.window as unknown as { shared: Helpers }).shared;

  /** The element drawn for the props given. */
  const draw = (props: Record<string, unknown>): Element => {
    const container = core.document.createElement('div');
    shared().render(shared().h(shared().EmptyState, props), container);
    assert.strictEqual(container.children.length, 1, 'one element');
    return container.children[0];
  };

  test('the state line alone, in a paragraph of the class every empty place had', () => {
    const line = draw({ state: 'No tasks match this search.' });
    assert.strictEqual(line.outerHTML, '<p class="empty">No tasks match this search.</p>');
  });

  test('the teaching line follows, marked help-text, and the words read as one sentence did', () => {
    const line = draw({ state: 'No tasks.', teach: 'Drag a card here, or right-click one.', class: 'board-empty' });
    assert.strictEqual(line.className, 'board-empty');
    assert.strictEqual(line.textContent, 'No tasks. Drag a card here, or right-click one.');
    const taught = line.querySelectorAll('.help-text');
    assert.strictEqual(taught.length, 1);
    assert.strictEqual(taught[0].textContent, ' Drag a card here, or right-click one.');
    // Hidden, the state line is what is left.
    taught[0].remove();
    assert.strictEqual(line.textContent, 'No tasks.', 'the state line is never inside the help');
  });

  test('one next step comes last, outside the help', () => {
    const action = shared().h('button', { type: 'button', 'data-action': 'customize-home' }, 'Customize');
    const line = draw({ state: 'Home has no widgets.', teach: 'Add one.', action, as: 'div' });
    assert.strictEqual(line.localName, 'div');
    assert.strictEqual(line.textContent, 'Home has no widgets. Add one. Customize');
    assert.strictEqual(line.lastElementChild?.getAttribute('data-action'), 'customize-home');
    assert.strictEqual(line.querySelector('.help-text button'), null, 'a control is never help text');
  });
});
