import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { ICON_PATHS, strokeIcon } from '../ui/webview/icons';

/**
 * Every glyph a control carries comes from one set, drawn at one size and
 * one stroke, so a chevron on Home and a sort arrow on the Board match. A
 * page that draws its own <svg> has left the set.
 */
suite('Icons', () => {
  test('no page draws its own svg', () => {
    const dir = path.resolve(__dirname, '..', '..', 'src', 'ui', 'webview');
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('Html.ts'))
      .filter((name) => fs.readFileSync(path.join(dir, name), 'utf8').includes('<svg'));
    assert.deepStrictEqual(offenders, [], 'icons come from icons.ts');
  });

  test('the shared frame is 16px, stroked, and hidden from the accessibility tree', () => {
    const svg = strokeIcon(ICON_PATHS.sort);
    assert.ok(svg.includes('viewBox="0 0 16 16"'));
    assert.ok(svg.includes('stroke-width="1.5"'));
    assert.ok(svg.includes('aria-hidden="true"'));
    assert.ok(svg.includes('class="toolbar-icon"'), 'the default class fits a button');
    assert.ok(strokeIcon(ICON_PATHS.sort, 'control-icon-svg').includes('class="control-icon-svg"'));
  });
});
