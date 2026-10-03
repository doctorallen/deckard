import * as assert from 'assert';

import { tokenizeInline } from '../domain/markdown/inline';
import { renderMarkdownInline } from './legacyMarkdown';
import { bundleShared } from './sharedBundle';
import { templateRecords } from './templateRecords';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The pages' shared core (src/webview/shared) against the template script
 * it replaced (getComponentScript, deleted in Phase 6 step 7): each
 * component must draw the DOM the template's helper drew, node for node,
 * and each floating layer must show what the template's showed. The
 * template's side is its recording (templateRecords.ts), taken in Replicant
 * with the help icon of src/ui/webview/icons.ts.
 */

/** What the template drew, by case. */
const drawnByTemplate = templateRecords('webview-shared');

/** A page running the core, with its exports on `window.shared`, in Replicant as its shell names it. */
function corePage(): WebviewPage {
  const bundle = bundleShared(['buttons', 'icons', 'inline', 'keySheet', 'loading', 'metric', 'status', 'tagLabel', 'tip', 'undoToast', 'viewOptions']);
  return openWebviewPage(`<!DOCTYPE html><html><head><meta name="deckard-theme" content="Replicant"></head><body><main id="app"></main><div id="live-status"></div><script>${bundle}</script></body></html>`);
}

type Helpers = Record<string, (...args: unknown[]) => unknown>;

suite('The shared page core draws what the template script drew', () => {
  let core: WebviewPage;
  suiteSetup(() => {
    core = corePage();
  });
  suiteTeardown(() => {
    core.dispose();
  });

  const shared = (): Helpers => (core.window as unknown as { shared: Helpers }).shared;
  /** A component of the core as a Preact element, made in the core's page. */
  const element = (name: string, props: object, ...children: unknown[]): unknown =>
    shared().h(shared()[name], props, ...children);

  /** What the template script wrote for a case, parsed as it parsed it. */
  const drawnBefore = (name: string, parent = 'div'): Element => {
    const container = core.document.createElement(parent);
    container.innerHTML = drawnByTemplate(name);
    container.normalize();
    return container;
  };
  /**
   * A floating layer as the template left it on the body. The recording is
   * its HTML, which joins neighboring text, so the layer drawn now is
   * compared with its text joined too.
   */
  const layerBefore = (name: string): Element => drawnBefore(name).firstElementChild as Element;
  const layerNow = (selector: string): Element => {
    const layer = core.find(selector).cloneNode(true) as Element;
    layer.normalize();
    return layer;
  };
  /** What the core draws, in its page. */
  const drawnNow = (vnode: unknown, parent = 'div'): Element => {
    const container = core.document.createElement(parent);
    shared().render(vnode, container);
    container.normalize();
    return container;
  };
  const assertSame = (before: Element, now: Element, what: string): void => {
    assert.ok(before.isEqualNode(now), `${what}\n  before: ${before.innerHTML}\n  now:    ${now.innerHTML}`);
  };

  test('a tag label, as HTML and inside an SVG node', () => {
    for (const label of ['#project/atlas', '@person/ana', '#topic', 'plain', '#a/b/c', '#<b>&"']) {
      assertSame(drawnBefore(`tagLabel ${label}`), drawnNow(element('TagLabel', { label })), label);
      const svgBefore = core.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      svgBefore.innerHTML = drawnByTemplate(`tagLabel ${label} in SVG`);
      const svgNow = core.document.createElementNS('http://www.w3.org/2000/svg', 'text');
      shared().render(element('TagLabel', { label, svg: true }), svgNow);
      assertSame(svgBefore, svgNow, `${label} in SVG`);
    }
  });

  test('a metric, with and without its search, caption, and twelve weeks', () => {
    const trend = { points: [1, 1, 2, 2, 3, 5, 5, 5, 8, 8, 9, 9, 12], change: 3, note: 'The line counts notes by date.' };
    const cases: Array<[string, unknown, string?, string?, string?, object?]> = [
      ['Files', 4],
      ['Files', 0],
      ['Notes', 12, 'is:note', 'Open a search for every note', undefined, trend],
      ['Tasks', 7, 'is:task', 'Open a search for every task', 'TSK.OVR // 01'],
      ['Open tasks', 2, 'is:open', 'Open a search for every open task', undefined, { points: [2, 2], change: 0 }],
      ['Flat', 5, undefined, undefined, 'FLT // 02', { points: [5, 5, 5], change: -2 }],
      ['One point', 5, 'is:note', 'Hint', undefined, { points: [5], change: 1 }],
    ];
    for (const [label, value, query, hint, code, trendOf] of cases) {
      assertSame(
        drawnBefore(`metric ${label} ${value}`),
        drawnNow(element('Metric', { label, value, query, hint, code, trend: trendOf })),
        label,
      );
    }
    for (const change of [0, 9, -3]) {
      assert.strictEqual(shared().describeChange(change), drawnByTemplate(`describeChange ${change}`));
    }
  });

  test('an icon button, the help button, and the icons they carry', () => {
    const helpNow = (): unknown => element('HelpIcon', {});
    assertSame(
      drawnBefore('iconButton with every option'),
      drawnNow(element('IconButton', {
        action: 'refresh', label: 'Refresh', icon: helpNow(), tip: 'Refresh now', tipKey: 'R', className: 'is-big',
        attributes: { 'data-scope': 'home' }, pressed: false, disabledReason: 'Nothing to refresh',
      })),
      'every option',
    );
    assertSame(drawnBefore('iconButton pressed'), drawnNow(element('IconButton', { label: 'Close', icon: helpNow(), pressed: true })), 'a pressed toggle');
    assertSame(drawnBefore('helpButton at an anchor'), drawnNow(element('HelpButton', { anchor: 'periodic' })), 'help at an anchor');
    assertSame(drawnBefore('helpButton'), drawnNow(element('HelpButton', {})), 'help');
  });

  test('the gear with its theme and zen rows, and a row of choices', () => {
    const viewOptions = (): void => {
      const now = [shared().themeOption(), shared().zenOption(), {
        label: 'Layout',
        stacked: true,
        content: element('ViewOptionChoices', {
          action: 'set-layout', choices: [['list', 'List'], ['board', 'Board', 'Show as a board']], selected: 'board', label: 'Layout', attributes: { 'data-scope': 'home' },
        }),
      }];
      const zen = core.document.body.classList.contains('zen');
      assertSame(drawnBefore(zen ? 'viewOptions zen' : 'viewOptions'), drawnNow(element('ViewOptions', { groups: now })), `zen ${zen}`);
    };
    viewOptions();
    core.document.body.classList.add('zen');
    try {
      viewOptions();
    } finally {
      core.document.body.classList.remove('zen');
    }
  });

  test('the loading line, and how far the first scan has got', () => {
    for (const immediate of [false, true]) {
      assertSame(drawnBefore(`loading immediate ${immediate}`), drawnNow(element('Loading', { label: 'Loading statistics…', immediate })), `immediate ${immediate}`);
    }
    for (const progress of [{ completed: 412, total: 3760 }, { completed: 0, total: 0 }, null]) {
      assert.strictEqual(shared().describeIndexing(progress), drawnByTemplate(`describeIndexing ${JSON.stringify(progress)}`));
    }
  });

  test('a title in inline Markdown, as markdown-it and the sanitizer drew it', () => {
    const titles = [
      'Plain words', '**Bold** and *em* and _under_', 'Code `x < y` here', 'Line one\nLine two',
      '[Site](https://example.com "Example")', '[Mail](mailto:a@example.com)', 'A [[Wiki link]] stays', 'An ![[embed]] too',
      'Escapes \\*not em\\* &amp; &copy; &#35;', 'Nested **bold *and em* here**', '<b>not html</b>', 'Link [**strong**](https://x.example/a b)',
    ];
    for (const title of titles) {
      const tokens = JSON.parse(JSON.stringify(tokenizeInline(title)));
      const before = core.document.createElement('div');
      before.innerHTML = renderMarkdownInline(title);
      before.normalize();
      assertSame(before, drawnNow(element('Inline', { tokens })), title);
    }
  });

  test('the key sheet opens over the page with Close focused, and gives focus back when it closes', () => {
    const sections = [{ title: 'This page', keys: [['j', 'Next'], ['k', 'Previous']] }];
    const opener = core.document.createElement('button');
    opener.id = 'opener';
    core.document.body.appendChild(opener);
    opener.focus();
    shared().openKeySheet(sections);
    assertSame(layerBefore('keySheet'), layerNow('.key-sheet'), 'the sheet');
    assert.strictEqual(core.find('.key-sheet').parentElement, core.document.body, 'a layer of the body, outside #app');
    assert.strictEqual(core.document.activeElement?.getAttribute('data-action'), 'close-key-sheet');
    shared().closeKeySheet();
    assert.strictEqual(core.findAll('.key-sheet').length, 0);
    assert.strictEqual(core.document.activeElement?.id, 'opener');
  });

  test('an offer of Undo is drawn in its toast, focused, and taken back with its payload', () => {
    const now = shared().createUndoNotice(() => undefined) as { show(...args: unknown[]): void; take(): unknown; clear(): void };
    now.show('Removed Tasks view.', 'undo-remove-widget', { id: 'tasks' });
    assertSame(layerBefore('undoToast shown'), layerNow('#undo-toast'), 'the toast');
    assert.strictEqual(core.find('#undo-toast').parentElement, core.document.body);
    assert.strictEqual(core.document.activeElement?.textContent, 'Undo');
    assert.deepStrictEqual(now.take(), { id: 'tasks' });
    assertSame(layerBefore('undoToast taken'), layerNow('#undo-toast'), 'the toast once taken');
    assert.strictEqual(now.take(), undefined);
    assertSame(drawnBefore('undoNotice with a button class'), drawnNow(element('UndoNotice', { message: 'Gone.', action: 'undo', buttonClass: 'text-button' })), 'a notice with a button class');
  });

  test('a tip shows on keyboard focus with its key, and goes with the focus', () => {
    shared().installTip();
    core.document.body.insertAdjacentHTML('beforeend', '<button id="tipped" type="button" aria-label="Refresh" data-tip="Read every note again" data-tip-key="R">R</button>');
    core.document.dispatchEvent(new core.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    (core.find('#tipped') as HTMLElement).focus();
    assertSame(layerBefore('tip shown'), layerNow('#deckard-tip'), 'the tip');
    assert.strictEqual(core.find('#deckard-tip').parentElement, core.document.body);
    assert.strictEqual(core.find('#tipped').getAttribute('aria-describedby'), 'deckard-tip');
    (core.find('#tipped') as HTMLElement).blur();
    assertSame(layerBefore('tip hidden'), layerNow('#deckard-tip'), 'the tip, hidden');
    assert.strictEqual(core.find('#tipped').getAttribute('aria-describedby'), null);
  });

  test('a page says one short thing at a time to a screen reader', () => {
    shared().announce('Saved.');
    shared().announce('Saved.');
    assert.strictEqual(core.text('#live-status'), 'Saved.');
  });
});
