import * as assert from 'assert';

import { BlockToken, buildBlockExcerpt } from '../domain/markdown/blockExcerpt';
import { InlineToken } from '../domain/markdown/inline';

/** Inline tokens as their words, with a break as `/`, for stating a block's contents briefly. */
function words(tokens: readonly InlineToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case 'text':
        case 'code':
        case 'wikiLink':
          return token.text;
        case 'break':
          return '/';
        case 'strong':
        case 'em':
        case 'del':
        case 'link':
          return words(token.children);
      }
    })
    .join('');
}

/**
 * Blocks in a compact notation: `p(words)`, `h2(words)`, `ul(…)` or
 * `ol3(…)` with `tight` or `loose` and each item in brackets, `code(text)`,
 * `quote(…)`, `hr`, and `table(cell|cell; cell|cell)`.
 */
function outline(blocks: readonly BlockToken[]): string {
  return blocks.map(outlineBlock).join(' ');
}

/** One block in the notation of `outline`. */
function outlineBlock(block: BlockToken): string {
  switch (block.kind) {
    case 'paragraph':
      return `p(${words(block.children)})`;
    case 'heading':
      return `h${block.level}(${words(block.children)})`;
    case 'list': {
      const name = `${block.ordered ? 'ol' : 'ul'}${block.start ?? ''}`;
      const items = block.items.map((item) => `[${outline(item)}]`).join('');
      return `${name}(${block.tight ? 'tight' : 'loose'} ${items})`;
    }
    case 'code':
      return `code(${JSON.stringify(block.text)})`;
    case 'quote':
      return `quote(${outline(block.children)})`;
    case 'rule':
      return 'hr';
    case 'table':
      return `table(${block.rows.map((row) => row.map(words).join('|')).join('; ')})`;
  }
}

suite('Block excerpt: paragraphs and headings', () => {
  test('nothing, or only blank lines, is no blocks', () => {
    assert.deepStrictEqual(buildBlockExcerpt(''), []);
    assert.deepStrictEqual(buildBlockExcerpt('  \n\t\n'), []);
  });

  test('blank lines split paragraphs, and each line inside one is a break', () => {
    assert.strictEqual(outline(buildBlockExcerpt('one\n  two  \n\nthree\r\nfour')), 'p(one/two) p(three/four)');
  });

  test('a paragraph holds inline tokens', () => {
    const [paragraph] = buildBlockExcerpt('**bold** [[Note]]');
    assert.deepStrictEqual(paragraph, {
      kind: 'paragraph',
      children: [
        { kind: 'strong', children: [{ kind: 'text', text: 'bold' }] },
        { kind: 'text', text: ' ' },
        { kind: 'wikiLink', text: '[[Note]]', target: 'Note', embed: false },
      ],
    });
  });

  test('ATX headings, with closing hashes dropped only after a space', () => {
    assert.strictEqual(outline(buildBlockExcerpt('# One\n## Two ##\n### Three#\n###### Six\n#\n')), 'h1(One) h2(Two) h3(Three#) h6(Six) h1()');
  });

  test('a tag, seven hashes, or four spaces of indent is not a heading', () => {
    assert.strictEqual(outline(buildBlockExcerpt('#tag line\n\n####### seven\n\n    # code')), 'p(#tag line) p(####### seven) code("# code\\n")');
  });

  test('setext headings, and a rule after a blank line', () => {
    assert.strictEqual(outline(buildBlockExcerpt('Title\n===\nWords\n---\n\n---')), 'h1(Title) h2(Words) hr');
    assert.strictEqual(outline(buildBlockExcerpt('Two\nlines\n-')), 'h2(Two/lines)');
  });
});

suite('Block excerpt: rules, code, and quotes', () => {
  test('rules of three or more markers, with spaces between allowed', () => {
    assert.strictEqual(outline(buildBlockExcerpt('***\n\n- - -\n\n_ _ _\n\n--')), 'hr hr hr p(--)');
  });

  test('fenced code is verbatim, markers and all, and its info string is dropped', () => {
    assert.strictEqual(outline(buildBlockExcerpt('```js\n*x* [[y]]\n\n  z\n```\nafter')), 'code("*x* [[y]]\\n\\n  z\\n") p(after)');
  });

  test('a tilde fence closes only on tildes at least as long, or the end', () => {
    assert.strictEqual(outline(buildBlockExcerpt('~~~~\n```\n~~~\n~~~~')), 'code("```\\n~~~\\n")');
    assert.strictEqual(outline(buildBlockExcerpt('~~~\nunclosed')), 'code("unclosed")');
  });

  test('a backtick fence whose info holds a backtick is a paragraph', () => {
    assert.strictEqual(outline(buildBlockExcerpt('``` a`b\ntext')), 'p(``` a`b/text)');
  });

  test('indented code keeps blank lines inside it', () => {
    assert.strictEqual(outline(buildBlockExcerpt('    one\n\n      two\nafter')), 'code("one\\n\\n  two\\n") p(after)');
  });

  test('code-indented lines continue a paragraph rather than start code', () => {
    assert.strictEqual(outline(buildBlockExcerpt('para\n    more')), 'p(para/more)');
  });

  test('quotes nest, and a lazy line continues the paragraph inside', () => {
    assert.strictEqual(outline(buildBlockExcerpt('> one\nlazy\n> > inner\n\nafter')), 'quote(p(one/lazy) quote(p(inner))) p(after)');
  });

  test('a lazy line that is not a paragraph line ends the quote', () => {
    assert.strictEqual(outline(buildBlockExcerpt('> # Title\nafter')), 'quote(h1(Title)) p(after)');
  });
});

suite('Block excerpt: lists', () => {
  test('a tight bullet list, task boxes as text', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- [ ] open #tag\n- [x] done')), 'ul(tight [p([ ] open #tag)][p([x] done)])');
  });

  test('a blank line between items makes a list loose', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\n\n- b')), 'ul(loose [p(a)][p(b)])');
  });

  test('a blank line between an item’s blocks makes it loose too', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\n\n  more\n- b')), 'ul(loose [p(a) p(more)][p(b)])');
  });

  test('lists nest by indent, and an inner blank line leaves the outer list tight', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\n  - b\n\n  - c\n- d')), 'ul(tight [p(a) ul(loose [p(b)][p(c)])][p(d)])');
  });

  test('a numbered list keeps a start other than 1', () => {
    assert.strictEqual(outline(buildBlockExcerpt('3. three\n4. four')), 'ol3(tight [p(three)][p(four)])');
    assert.strictEqual(outline(buildBlockExcerpt('1) one\n2) two')), 'ol(tight [p(one)][p(two)])');
  });

  test('a different bullet or delimiter starts a new list', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\n* b\n1. c\n1) d')), 'ul(tight [p(a)]) ul(tight [p(b)]) ol(tight [p(c)]) ol(tight [p(d)])');
  });

  test('only a list starting at 1, with words, interrupts a paragraph', () => {
    assert.strictEqual(outline(buildBlockExcerpt('para\n2. two')), 'p(para/2. two)');
    assert.strictEqual(outline(buildBlockExcerpt('para\n*\nnext')), 'p(para/*/next)');
    assert.strictEqual(outline(buildBlockExcerpt('para\n1. one')), 'p(para) ol(tight [p(one)])');
  });

  test('an item holds code and quotes indented to its content', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\n  ```\n  b\n  ```\n- > c')), 'ul(tight [p(a) code("b\\n")][quote(p(c))])');
  });

  test('a lazy line continues an item’s paragraph', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\nb')), 'ul(tight [p(a/b)])');
  });

  test('`---` under an item ends the list as a rule, not a setext heading', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- one\n---')), 'ul(tight [p(one)]) hr');
  });

  test('empty items', () => {
    assert.strictEqual(outline(buildBlockExcerpt('- a\n-\n- c')), 'ul(tight [p(a)][][p(c)])');
  });
});

suite('Block excerpt: tables', () => {
  test('a table is its rows of cells, header first, missing cells empty', () => {
    assert.strictEqual(outline(buildBlockExcerpt('| a | *b* |\n|---|:-:|\n| c \\| d | e |\n| f |')), 'table(a|b; c | d|e; f|)');
  });

  test('a table may interrupt a paragraph and ends at a blank line', () => {
    assert.strictEqual(outline(buildBlockExcerpt('text\n| a | b |\n| - | - |\n\nafter')), 'p(text) table(a|b) p(after)');
  });

  test('a delimiter row that does not match the header makes no table', () => {
    assert.strictEqual(outline(buildBlockExcerpt('| a | b |\n|---|\n')), 'p(| a | b |/|---|)');
  });
});
