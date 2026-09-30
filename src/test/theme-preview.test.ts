import * as assert from 'assert';

import { ThemePreview } from '../ui/webview/themePreview';

/** The theme Choose Theme… shows on the open pages before one is kept. */
suite('Theme preview', () => {
  test('shows nothing until a theme is previewed, and stops when told', () => {
    const preview = new ThemePreview();
    assert.strictEqual(preview.current, undefined);
    preview.show('cooper');
    assert.strictEqual(preview.current, 'cooper');
    preview.show(undefined);
    assert.strictEqual(preview.current, undefined);
  });

  test('tells the pages of each change, once, and of a silent one not at all', () => {
    const preview = new ThemePreview();
    let redraws = 0;
    preview.onDidChange(() => (redraws += 1));
    preview.show('lcars');
    preview.show('lcars');
    assert.strictEqual(redraws, 1, 'the same theme again is no change');
    preview.show(undefined, { silent: true });
    assert.strictEqual(redraws, 1, 'a silent stop redraws nothing');
    assert.strictEqual(preview.current, undefined);
  });

  test('two previews do not share a theme', () => {
    const first = new ThemePreview();
    first.show('synthwave');
    assert.strictEqual(new ThemePreview().current, undefined);
  });
});
