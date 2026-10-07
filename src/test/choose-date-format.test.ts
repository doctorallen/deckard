import * as assert from 'assert';
import * as vscode from 'vscode';

import { DEFAULT_DATE_FORMATS } from '../domain/markdown/dateFormat';
import { createDateFormatItems, DATE_FORMAT_PRESETS, describeTypedFormat } from '../ui/commands/chooseDateFormat';

/**
 * Choose Date Format…: each preset shows today in it, the one in use is
 * marked, and Custom… says today back in a format as it is typed.
 */
suite('Choose Date Format', () => {
  // Tuesday 2026-10-06.
  const NOW = new Date(2026, 9, 6, 9, 30).getTime();

  test('shows today in each preset, and marks the one in use', () => {
    const items = createDateFormatItems(DEFAULT_DATE_FORMATS, NOW);
    const presets = items.filter((item) => item.format !== undefined);
    assert.deepStrictEqual(presets.map((item) => item.format), DATE_FORMAT_PRESETS);
    assert.deepStrictEqual(presets.slice(0, 5).map((item) => item.label), ['2026-10-06', '10/06/2026', '06/10/2026', '6 Oct 2026', 'Tue, Oct 6, 2026']);
    assert.strictEqual(presets[0].description, 'YYYY-MM-DD · In use');
    assert.strictEqual(presets[1].description, 'MM/DD/YYYY');
    assert.strictEqual(items[items.length - 1].label, 'Custom…');
  });

  test('Custom… names a format of the reader\'s own as in use', () => {
    const items = createDateFormatItems({ ...DEFAULT_DATE_FORMATS, date: '[Day] DDD [of] YYYY' }, NOW);
    assert.ok(items.every((item) => !item.description?.endsWith('In use') || item.custom), 'no preset is in use');
    assert.strictEqual(items[items.length - 1].description, '[Day] DDD [of] YYYY · In use');
  });

  test('says today back as a format is typed, and refuses one that writes no date', () => {
    const said = describeTypedFormat('dddd, D MMMM', DEFAULT_DATE_FORMATS, NOW) as vscode.InputBoxValidationMessage;
    assert.strictEqual(said.message, 'Today: Tuesday, 6 October');
    assert.strictEqual(said.severity, vscode.InputBoxValidationSeverity.Info);
    assert.strictEqual(typeof describeTypedFormat('[no date]', DEFAULT_DATE_FORMATS, NOW), 'string', 'an error, which the box will not accept');
    const empty = describeTypedFormat('  ', DEFAULT_DATE_FORMATS, NOW) as vscode.InputBoxValidationMessage;
    assert.strictEqual(empty.message, 'Empty puts back YYYY-MM-DD: 2026-10-06');
  });
});
