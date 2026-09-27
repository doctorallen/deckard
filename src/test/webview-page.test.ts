import * as assert from 'assert';

import { openWebviewPage } from './webviewPage';

suite('Webview page harness', () => {
  const page = (script: string) => `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>${script}</script></body></html>`;

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
});
