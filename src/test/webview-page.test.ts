import * as assert from 'assert';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { openWebviewPage } from './webviewPage';

suite('Webview page harness', () => {
  const page = (script: string) => `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>${script}</script></body></html>`;

  test('a page that did not ask for the recording canvas still gets a 2D context, as in a webview', () => {
    const opened = openWebviewPage(
      page(`document.body.setAttribute('data-context', String(document.getElementById('c').getContext('2d') !== null));`),
    );
    try {
      assert.strictEqual(opened.document.body.getAttribute('data-context'), 'true');
    } finally {
      opened.dispose();
    }
  });

  test('a canvas page is drawn into a recording', () => {
    const opened = openWebviewPage(
      page(`
        var ctx = document.getElementById('c').getContext('2d');
        ctx.strokeStyle = 'red';
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(1, 2);
        ctx.lineTo(3, 4);
        ctx.stroke();
        document.body.setAttribute('data-width', String(ctx.measureText('abc').width));
      `),
      undefined,
      { canvas: true },
    );
    try {
      const ops = opened.canvasCalls.map((call) => call.op);
      assert.deepStrictEqual(ops.filter((op) => op !== 'measureText'), ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke']);
      const stroke = opened.canvasCalls.find((call) => call.op === 'stroke');
      assert.deepStrictEqual(stroke?.lineDash, [5, 3]);
      assert.strictEqual(stroke?.strokeStyle, 'red');
      assert.strictEqual(stroke?.globalAlpha, 0.5);
      assert.deepStrictEqual(opened.canvasCalls.find((call) => call.op === 'moveTo')?.args, [1, 2]);
      assert.strictEqual(opened.document.body.getAttribute('data-width'), '21');
    } finally {
      opened.dispose();
    }
  });

  test('animation frames wait until they are flushed', () => {
    const opened = openWebviewPage(
      page(`
        var ran = 0;
        function frame() { ran += 1; document.body.setAttribute('data-ran', String(ran)); if (ran < 3) requestAnimationFrame(frame); }
        requestAnimationFrame(frame);
      `),
      undefined,
      { canvas: true },
    );
    try {
      assert.strictEqual(opened.document.body.getAttribute('data-ran'), null);
      assert.strictEqual(opened.flushFrames(), 1);
      assert.strictEqual(opened.document.body.getAttribute('data-ran'), '1');
      assert.strictEqual(opened.flushFrames(10), 2, 'a frame asking for another runs in the next round');
      assert.strictEqual(opened.document.body.getAttribute('data-ran'), '3');
    } finally {
      opened.dispose();
    }
  });

  test('a stepped clock moves on by the same amount each time it is read', () => {
    const opened = openWebviewPage(
      page(`
        var read = [performance.now(), performance.now()];
        requestAnimationFrame(function (time) { read.push(time); document.body.setAttribute('data-read', read.join(',')); });
      `),
      undefined,
      { canvas: true, clockStep: 16 },
    );
    try {
      opened.flushFrames();
      assert.strictEqual(opened.document.body.getAttribute('data-read'), '16,32,48', 'a frame is given the clock too');
    } finally {
      opened.dispose();
    }
  });

  test('with DECKARD_DOM_RECORD, the body is recorded after each message and click', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'deckard-dom-record-'));
    const previous = process.env.DECKARD_DOM_RECORD;
    process.env.DECKARD_DOM_RECORD = folder;
    try {
      const opened = openWebviewPage(page(`
        window.addEventListener('message', function (event) { document.body.setAttribute('data-count', String(event.data.data)); });
        document.addEventListener('click', function () { document.body.className = 'clicked'; });
      `));
      opened.send(1);
      opened.click('canvas');
      opened.dispose();
      const records = path.join(folder, 'webview-page.test.js');
      const files = readdirSync(records).sort();
      assert.deepStrictEqual(files.map((file) => file.replace(/^\d{4}-/, '')), ['0001.html', '0002.html']);
      const [sent, clicked] = files.map((file) => readFileSync(path.join(records, file), 'utf8'));
      assert.match(sent, /^<!-- send state -->\n<body\n {2}data-count="1"\n>/);
      assert.match(clicked, /^<!-- click canvas -->\n<body\n {2}class="clicked"\n {2}data-count="1"\n>/);
    } finally {
      if (previous === undefined) {
        delete process.env.DECKARD_DOM_RECORD;
      } else {
        process.env.DECKARD_DOM_RECORD = previous;
      }
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
