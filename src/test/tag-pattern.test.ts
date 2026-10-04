import * as assert from 'assert';

import { createTagLabelPattern } from '../webview/shared/tagPattern';

/** Each label the pattern finds in `text`, with where. */
function find(labels: string[], text: string): string[] {
  const pattern = createTagLabelPattern(labels);
  return pattern ? [...text.matchAll(pattern)].map((match) => `${match[0]}@${match.index}`) : [];
}

suite('Tag buttons in text', () => {
  test('find a tag written as a tag, longest first', () => {
    assert.deepStrictEqual(find(['#atlas', '#project/atlas'], '#atlas, (#project/atlas).'), ['#atlas@0', '#project/atlas@9']);
    assert.deepStrictEqual(find(['#a.b', '#c+d'], 'see #a.b and #c+d'), ['#a.b@4', '#c+d@13'], 'a label’s own pattern characters are matched as written');
  });

  test('leave a label inside a word, an email address, a path, or a longer tag alone', () => {
    assert.deepStrictEqual(find(['@dana'], 'bob@danaher.com and über@dana'), []);
    assert.deepStrictEqual(find(['#atlas'], 'https://example.com/docs#atlas #atlas-x #atlas/sub'), []);
    assert.deepStrictEqual(find(['@dana'], 'Ask @dana.'), ['@dana@4']);
  });

  test('find nothing without a label', () => {
    assert.strictEqual(createTagLabelPattern(['']), undefined);
  });
});
