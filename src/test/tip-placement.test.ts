import * as assert from 'assert';

import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * Where the tip goes (src/webview/shared/tip.tsx). jsdom lays nothing out,
 * so each test says where every element it names is drawn, as a box in the
 * window, and reads back where the tip was put. The tip itself is 200 by 40.
 */

/** A box on the screen: where it starts and how big it is. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const TIP: Box = { left: 0, top: 0, width: 200, height: 40 };

suite('Tip placement', () => {
  let page: WebviewPage | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  /**
   * A page with only the tip's script, a window of the size given, and the
   * markup given, whose elements are drawn where `boxes` says by id; any
   * other element is drawn nowhere.
   */
  const open = (markup: string, boxes: Record<string, Box>, size: [number, number] = [400, 600]): WebviewPage => {
    const bundle = bundleShared(['tip']);
    page = openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app">${markup}</main><script>${bundle}</script></body></html>`);
    const { window } = page;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: size[0] });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: size[1] });
    Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Element) {
        const box = this.id === 'deckard-tip' ? TIP : boxes[this.id] ?? { left: 0, top: 0, width: 0, height: 0 };
        return { x: box.left, y: box.top, ...box, right: box.left + box.width, bottom: box.top + box.height };
      },
    });
    (window as unknown as { shared: { installTip(): void } }).shared.installTip();
    return page;
  };

  /** Focuses an element from the keyboard, which shows its tip at once. */
  const keyFocus = (target: WebviewPage, id: string): void => {
    target.document.dispatchEvent(new target.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    (target.find(`#${id}`) as HTMLElement).focus();
  };

  /** Where the tip was put, as a box. */
  const tipBox = (target: WebviewPage): Box => {
    const tip = target.find('#deckard-tip') as HTMLElement;
    assert.strictEqual(tip.hidden, false, 'the tip shows');
    return { left: parseFloat(tip.style.left), top: parseFloat(tip.style.top), width: TIP.width, height: TIP.height };
  };

  const overlaps = (a: Box, b: Box): boolean =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

  test('a control in no card gets its tip under it, as it always has', () => {
    const shown = open('<button id="go" data-tip="Run this search">Go</button>', { go: { left: 100, top: 100, width: 60, height: 24 } });
    keyFocus(shown, 'go');
    assert.deepStrictEqual(tipBox(shown), { left: 30, top: 130, width: 200, height: 40 });
  });

  test('a control in no card, with no room below, gets its tip above it', () => {
    const shown = open('<button id="go" data-tip="Run this search">Go</button>', { go: { left: 100, top: 540, width: 60, height: 24 } });
    keyFocus(shown, 'go');
    assert.strictEqual(tipBox(shown).top, 540 - 6 - 40);
  });

  test('a card\'s tip covers neither the card nor the panel it shows (the Related Notes card)', () => {
    // As David saw it: the relevance breakdown hangs from the card's score
    // and past its foot, and the card's tip was drawn over it.
    const card = { left: 10, top: 40, width: 380, height: 90 };
    const panel = { left: 160, top: 70, width: 220, height: 130 };
    const shown = open(
      `<article id="card" class="note" tabindex="0" data-tip-around data-tip="Open this entry.">
        <span class="relevance-wrap"><span id="panel" class="relevance-tooltip popover is-tip" role="tooltip">Relevance score</span></span>
      </article>`,
      { card, panel },
    );
    keyFocus(shown, 'card');
    const tip = tipBox(shown);
    assert.ok(!overlaps(tip, panel), `the tip ${JSON.stringify(tip)} covers the panel`);
    assert.ok(!overlaps(tip, card), `the tip ${JSON.stringify(tip)} covers the card`);
    assert.strictEqual(tip.top, 200 + 6, 'under the panel, the lowest thing the card shows');
  });

  test('a row\'s tip clears the line it carries down under it (Home\'s tag pairs)', () => {
    // The row's count folds under it on hover, in the row's frame carried
    // down --reach past its foot; the tip was drawn over it and the next row.
    const row = { left: 10, top: 100, width: 380, height: 28 };
    const detail = { left: 20, top: 130, width: 360, height: 16 };
    const shown = open(
      `<button id="row" class="row home-row" style="--reach: 24px" data-tip-around data-tip="8 notes carry both. Search for both.">
        <span class="home-row-label">#person/sable-ortiz + #team/harbor</span><span id="detail" class="home-row-detail">8× · 100%</span>
      </button>`,
      { row, detail },
    );
    keyFocus(shown, 'row');
    const tip = tipBox(shown);
    assert.ok(!overlaps(tip, detail), `the tip ${JSON.stringify(tip)} covers the detail`);
    assert.ok(tip.top >= 128 + 24 + 6, `the tip (top ${tip.top}) starts past the row's frame carried down`);
  });

  test('a card with no room under what it shows has its tip above it', () => {
    const card = { left: 10, top: 300, width: 380, height: 90 };
    const panel = { left: 160, top: 330, width: 220, height: 260 };
    const shown = open(
      `<article id="card" tabindex="0" data-tip-around data-tip="Open this entry.">
        <span id="panel" class="popover" role="tooltip">Relevance score</span>
      </article>`,
      { card, panel },
    );
    keyFocus(shown, 'card');
    assert.strictEqual(tipBox(shown).top, 300 - 6 - 40);
  });

  test('a card with room neither under nor over what it shows has its tip beside it', () => {
    const card = { left: 10, top: 30, width: 150, height: 500 };
    const panel = { left: 20, top: 100, width: 140, height: 470 };
    const shown = open(
      `<article id="card" tabindex="0" data-tip-around data-tip="Open this entry.">
        <span id="panel" class="popover">Relevance score</span>
      </article>`,
      { card, panel },
      [600, 600],
    );
    keyFocus(shown, 'card');
    const tip = tipBox(shown);
    assert.strictEqual(tip.left, 160 + 6, 'to the right of the card');
    assert.ok(!overlaps(tip, card) && !overlaps(tip, panel));
  });

  test('a button in a card keeps its tip by it while that covers nothing the card shows', () => {
    const card = { left: 10, top: 40, width: 380, height: 120 };
    const button = { left: 20, top: 50, width: 24, height: 24 };
    const panel = { left: 220, top: 80, width: 160, height: 130 };
    const shown = open(
      `<article id="card" tabindex="0" data-tip-around data-tip="Open this entry.">
        <button id="link" data-tip="Write a link to this entry">L</button>
        <span id="panel" class="popover" role="tooltip">Relevance score</span>
      </article>`,
      { card, link: button, panel },
    );
    keyFocus(shown, 'link');
    assert.deepStrictEqual(tipBox(shown), { left: 8, top: 80, width: 200, height: 40 }, 'right under the button');
  });

  test('a button in a card whose tip would cover what the card shows has it moved off', () => {
    const card = { left: 10, top: 40, width: 380, height: 120 };
    const button = { left: 330, top: 50, width: 24, height: 24 };
    const panel = { left: 160, top: 80, width: 220, height: 130 };
    const shown = open(
      `<article id="card" tabindex="0" data-tip-around data-tip="Open this entry.">
        <button id="link" data-tip="Write a link to this entry">L</button>
        <span id="panel" class="popover" role="tooltip">Relevance score</span>
      </article>`,
      { card, link: button, panel },
    );
    keyFocus(shown, 'link');
    const tip = tipBox(shown);
    assert.ok(!overlaps(tip, panel), `the tip ${JSON.stringify(tip)} covers the panel`);
  });

  test('a card that shows a panel after its tip did has the tip moved off it', async () => {
    // The pointer rests on the card, its tip shows, then the pointer moves
    // onto the score, and the breakdown opens under the tip.
    const card = { left: 10, top: 40, width: 380, height: 90 };
    const panel = { left: 160, top: 70, width: 220, height: 130 };
    const boxes: Record<string, Box> = { card, score: { left: 350, top: 45, width: 24, height: 24 } };
    const shown = open(
      `<article id="card" tabindex="0" data-tip-around data-tip="Open this entry.">
        <span class="relevance-wrap"><button id="score">S</button><span id="panel" class="popover" role="tooltip">Relevance score</span></span>
      </article>`,
      boxes,
    );
    keyFocus(shown, 'card');
    assert.strictEqual(tipBox(shown).top, 130 + 6, 'under the card, which shows nothing yet');
    boxes.panel = panel;
    shown.find('#score').dispatchEvent(new shown.window.MouseEvent('pointerover', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(tipBox(shown).top, 200 + 6, 'moved under the panel');
  });
});
