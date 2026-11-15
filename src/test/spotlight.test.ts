import * as assert from 'assert';

import { JSDOM } from 'jsdom';

import type { HelpPickedMessage } from '../ui/protocol/shared';
import { EXPLORING_CLASS, findSpotlightTarget, installSpotlight, PICKABLE_CLASS, SPOTLIGHT_CLASS } from '../webview/shared/spotlight';

/** A page with a board's controls, the spotlight installed, and what it told its host. */
function openPage(): { dom: JSDOM; sent: HelpPickedMessage[]; send(data: unknown): void } {
  const dom = new JSDOM(`<body>
    <label data-help-id="lanes">Lanes: <select><option>None</option></select></label>
    <section class="board"><article><h3>Recalibrate the survey array</h3><p>Due Thu</p></article>
    <article><h3>Hull inspection</h3></article></section>
    <button data-help-id="add" data-action="add-task">Add task</button>
  </body>`);
  const sent: HelpPickedMessage[] = [];
  installSpotlight((message) => sent.push(message), dom.window.document, dom.window as unknown as Window);
  const send = (data: unknown): void => {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
  };
  return { dom, sent, send };
}

suite('Spotlight and Point at something', () => {
  test('rings an element by its data-help-id, or the smallest one that holds the words', () => {
    const { dom, send } = openPage();
    const document = dom.window.document;
    assert.strictEqual(findSpotlightTarget(document, { id: 'lanes' })?.tagName, 'LABEL');
    assert.strictEqual(findSpotlightTarget(document, { text: 'survey array' })?.tagName, 'H3', 'the heading, not its card');
    assert.strictEqual(findSpotlightTarget(document, { text: 'nothing like this' }), undefined);
    send({ type: 'spotlight', text: 'Hull inspection', hold: true });
    assert.deepStrictEqual([...document.querySelectorAll(`.${SPOTLIGHT_CLASS}`)].map((element) => element.textContent), ['Hull inspection']);
    send({ type: 'spotlight', id: 'add', hold: true });
    assert.deepStrictEqual([...document.querySelectorAll(`.${SPOTLIGHT_CLASS}`)].map((element) => element.getAttribute('data-help-id')), ['add'], 'one ring at a time');
    send({ type: 'spotlight' });
    assert.strictEqual(document.querySelectorAll(`.${SPOTLIGHT_CLASS}`).length, 0, 'none names nothing, and takes the ring away');
  });

  test('in explore mode, a click picks what it lands on for Help instead of acting, and Escape ends it', () => {
    const { dom, sent, send } = openPage();
    const document = dom.window.document;
    let acted = 0;
    document.querySelector('[data-help-id="add"]')?.addEventListener('click', () => {
      acted += 1;
    });
    send({ type: 'explore', on: true });
    assert.ok(document.body.classList.contains(EXPLORING_CLASS));
    assert.strictEqual(document.querySelectorAll(`.${PICKABLE_CLASS}`).length, 2);
    (document.querySelector('[data-help-id="add"]') as HTMLElement).click();
    (document.querySelector('select') as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(sent, [{ type: 'helpPicked', id: 'add' }, { type: 'helpPicked', id: 'lanes' }], 'a click inside a control picks the control');
    assert.strictEqual(acted, 0, 'and the button did nothing');
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepStrictEqual(sent[sent.length - 1], { type: 'helpPicked' }, 'Escape tells Help explore mode ended');
    assert.strictEqual(document.querySelectorAll(`.${PICKABLE_CLASS}`).length, 0);
    (document.querySelector('[data-help-id="add"]') as HTMLElement).click();
    assert.strictEqual(acted, 1, 'and clicks act again');
  });
});
