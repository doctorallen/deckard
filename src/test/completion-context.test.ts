import * as assert from 'assert';

import {
  getBlockCompletionContext,
  getHeadingCompletionContext,
  getTagCompletionContext,
  getWikiLinkCompletionContext,
  matchesTagCompletion,
} from '../domain/markdown/completionContext';

suite('Tag completion context', () => {
  test('finds the tag token at the cursor and its replacement range', () => {
    assert.deepStrictEqual(getTagCompletionContext('Review @pro', 11), {
      marker: '@',
      query: 'pro',
      startColumn: 7,
      endColumn: 11,
    });
    assert.deepStrictEqual(getTagCompletionContext('Review @project', 10), {
      marker: '@',
      query: 'pr',
      startColumn: 7,
      endColumn: 15,
    });
    assert.deepStrictEqual(getTagCompletionContext('# Heading', 1), {
      marker: '#',
      query: '',
      startColumn: 0,
      endColumn: 1,
    });
    assert.deepStrictEqual(getTagCompletionContext('Review ~mar', 11, '~'), {
      marker: '~',
      query: 'mar',
      startColumn: 7,
      endColumn: 11,
    });
  });

  test('completes no tag in code, in a link, or inside an unclosed [[', () => {
    assert.strictEqual(getTagCompletionContext('Run `#build` now', 11), undefined);
    assert.strictEqual(getTagCompletionContext('See [[Atlas#Dec', 15), undefined);
    assert.strictEqual(getTagCompletionContext('mail me@home', 12), undefined);
  });

  test('matches a tag, or any segment of it, by what was typed after its marker', () => {
    const atlas = { key: '#project/atlas', label: '#project/atlas' };
    assert.strictEqual(matchesTagCompletion(atlas, '#', 'proj', '@'), true);
    assert.strictEqual(matchesTagCompletion(atlas, '#', 'atl', '@'), true);
    assert.strictEqual(matchesTagCompletion(atlas, '#', 'tlas', '@'), false);
    assert.strictEqual(matchesTagCompletion(atlas, '@', 'proj', '@'), false, 'the person marker offers people');
  });

  test('offers people after the person marker, and #tag-at/ tags after a bare @ when the marker is another', () => {
    const ren = { key: '@ren-kade', label: '@ren-kade' };
    const atHome = { key: '#tag-at/home', label: '@home' };
    assert.strictEqual(matchesTagCompletion(ren, '@', 'ren', '@'), true);
    assert.strictEqual(matchesTagCompletion(atHome, '@', 'ho', '@'), false);
    assert.strictEqual(matchesTagCompletion(ren, '~', 'ren', '~'), true);
    assert.strictEqual(matchesTagCompletion(atHome, '@', 'ho', '~'), true);
    assert.strictEqual(matchesTagCompletion(ren, '@', 'ren', '~'), false);
  });
});

suite('Wiki link completion context', () => {
  test('finds only an unfinished Wiki link target', () => {
    assert.deepStrictEqual(getWikiLinkCompletionContext('See [[Atlas', 11), {
      query: 'Atlas',
      startColumn: 6,
    });
    assert.strictEqual(getWikiLinkCompletionContext('See [Atlas]', 11), undefined);
  });

  test('reads the note and heading past a #, and every note past ##', () => {
    assert.deepStrictEqual(getHeadingCompletionContext('Atlas#Deci'), { note: 'Atlas', query: 'Deci' });
    assert.deepStrictEqual(getHeadingCompletionContext(' Atlas #'), { note: 'Atlas', query: '' });
    assert.deepStrictEqual(getHeadingCompletionContext('#Deci'), { note: '', query: 'Deci' });
    assert.deepStrictEqual(getHeadingCompletionContext('##Deci'), { note: undefined, query: 'Deci' });
    assert.strictEqual(getHeadingCompletionContext('Atlas'), undefined);
    assert.strictEqual(getHeadingCompletionContext('Atlas#^li'), undefined, 'a caret is a block, not a heading');
  });

  test('knows when a caret is being typed, and for which note', () => {
    assert.deepStrictEqual(getBlockCompletionContext('Check-in#^li'), {
      note: 'Check-in',
      query: 'li',
    });
    assert.deepStrictEqual(getBlockCompletionContext('#^'), {
      note: '',
      query: '',
    });
    assert.strictEqual(getBlockCompletionContext('Check-in#Vendor'), undefined);
    assert.strictEqual(getBlockCompletionContext('Check-in'), undefined);
  });
});
