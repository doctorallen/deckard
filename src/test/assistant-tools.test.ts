import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  answerQuery,
  answerTags,
  readQueryToolInput,
  readTagsToolInput,
} from '../ui/state/assistantTools';

function createIndex() {
  const files = [
    parseMarkdown(
      'notes/atlas.md',
      '# Atlas launch #project/atlas\nPlan the launch with @ren-kade.\n- [ ] Send the proposal 📅 2026-09-20 ⏫\n- [x] Draft the brief\n',
      { createdAt: 1, updatedAt: 2 },
      {},
    ),
    parseMarkdown(
      'notes/vendor.md',
      '# Vendor review #risk/vendor\n- [ ] Call the vendor #project/atlas\n',
      { createdAt: 1, updatedAt: 2 },
      {},
    ),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

suite('Assistant tools', () => {
  test('answers open tasks for a tag with their paths, lines, and details', () => {
    const text = answerQuery(createIndex(), {
      query: 'tag = #project/atlas AND task = open',
    });

    assert.match(text, /^Deckard query: tag = #project\/atlas AND task = open$/m);
    assert.match(text, /^Found 0 notes and 2 tasks \(2 open\)\.$/m);
    assert.match(
      text,
      /^- \[ \] Send the proposal — due 2026-09-20, high priority — notes\/atlas\.md:3 \(under Atlas launch\)$/m,
    );
    assert.match(text, /^- \[ \] Call the vendor — notes\/vendor\.md:2/m);
    assert.doesNotMatch(text, /Draft the brief/);
  });

  test('says how many results a higher limit would show', () => {
    const text = answerQuery(createIndex(), { query: 'task = any', limit: 1 });

    assert.match(text, /^Showing the first 1 of 3 tasks\.$/m);
    assert.match(text, /higher limit \(up to 200\)/);
  });

  test('returns why a query could not run, with the syntax', () => {
    const text = answerQuery(createIndex(), { query: '(tag = #project/atlas' });

    assert.match(text, /^The query could not run:$/m);
    assert.match(text, /Deckard query syntax:/);
  });

  test('points at the tag list when nothing matches', () => {
    const text = answerQuery(createIndex(), { query: 'tag = #project/nowhere' });

    assert.match(text, /Found 0 notes and 0 tasks/);
    assert.match(text, /deckard_list_tags lists the tags that exist/);
  });

  test('lists tags most used first, and narrows them by a search', () => {
    const index = createIndex();
    const all = answerTags(index, {});
    assert.ok(
      all.indexOf('#project/atlas') < all.indexOf('#risk/vendor'),
      all,
    );
    assert.match(all, /^- #project\/atlas — 2 entries$/m);

    const risks = answerTags(index, { search: '#risk' });
    assert.match(risks, /#risk\/vendor/);
    assert.doesNotMatch(risks, /#project\/atlas —/);
    assert.match(answerTags(index, { search: '@ren' }), /@ren-kade/);
    assert.match(answerTags(index, { search: 'nothing' }), /No tag matches "nothing"/);
  });

  test('reads only well-formed tool input', () => {
    assert.strictEqual(readQueryToolInput({}), undefined);
    assert.strictEqual(readQueryToolInput('tag = #a'), undefined);
    assert.deepStrictEqual(
      readQueryToolInput({ query: 'task = open', limit: 'many', sort: 'size' }),
      { query: 'task = open' },
    );
    assert.deepStrictEqual(
      readQueryToolInput({ query: 'task = open', limit: 5, sort: 'updated' }),
      { query: 'task = open', limit: 5, sort: 'updated' },
    );
    assert.deepStrictEqual(readTagsToolInput(null), {});
    assert.deepStrictEqual(readTagsToolInput({ search: 'atlas', limit: 3 }), {
      search: 'atlas',
      limit: 3,
    });
  });
});
