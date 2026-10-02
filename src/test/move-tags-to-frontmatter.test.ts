import * as assert from 'assert';

import { findCommentedTagField, moveInlineTagsToFrontmatterContent } from '../ui/commands/moveTagsToFrontmatter';

suite('Move inline tags to front matter', () => {
  test('groups explicit tags into typed front matter and removes their source tokens', () => {
    const transformed = moveInlineTagsToFrontmatterContent(
      [
        '# Launch #project/atlas #management/performance @mara-vale',
        '',
        '- [ ] Send the brief #topic/launch-readiness #follow-up',
      ].join('\n'),
    );

    assert.strictEqual(
      transformed,
      [
        '---',
        'people: [mara-vale]',
        'projects: [atlas]',
        'topics: [launch-readiness]',
        'tags: [management/performance, follow-up]',
        '---',
        '# Launch',
        '',
        '- [ ] Send the brief',
      ].join('\n'),
    );
  });

  test('merges supported fields and preserves unrelated front matter', () => {
    const transformed = moveInlineTagsToFrontmatterContent(
      [
        '---',
        'title: Launch brief',
        'topics: [operations]',
        'links:',
        '  - [[Project Atlas]]',
        '---',
        '# Launch #topic/operations #org/acme',
      ].join('\n'),
    );

    assert.strictEqual(
      transformed,
      [
        '---',
        'title: Launch brief',
        'links:',
        '  - [[Project Atlas]]',
        'topics: [operations]',
        'organizations: [acme]',
        '---',
        '# Launch',
      ].join('\n'),
    );
  });

  test('returns no replacement when a note has no explicit tags', () => {
    assert.strictEqual(
      moveInlineTagsToFrontmatterContent('# Untagged note\n\nNo tags here.'),
      undefined,
    );
  });

  test('quotes a tag YAML would misread unquoted', () => {
    assert.strictEqual(
      moveInlineTagsToFrontmatterContent('---\ntags: ["#x"]\n---\n# Plan #atlas #yes\n'),
      '---\ntags: ["#x", atlas, "yes"]\n---\n# Plan\n',
    );
  });

  test('leaves a note alone whose tag field ends in a comment, and names the field', () => {
    for (const note of ['---\ntags: [a] # mine\n---\n# Plan #atlas\n', '---\nPeople:\n  - dana # lead\n---\n# Plan #atlas\n']) {
      assert.strictEqual(moveInlineTagsToFrontmatterContent(note), undefined, note);
    }
    assert.strictEqual(findCommentedTagField('---\nPeople:\n  - dana # lead\n---\n'), 'People');
    assert.strictEqual(findCommentedTagField('---\ntitle: x # mine\ntags: [a]\n---\n'), undefined, 'another field may end in a comment');
  });
});
