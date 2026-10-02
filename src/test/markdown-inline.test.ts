import * as assert from 'assert';

import { InlineToken, tokenizeInline } from '../domain/markdown/inline';

/**
 * Tokens in a compact notation a test can state in one line: text as a JSON
 * string, a break as `br`, and anything else as its kind with its contents
 * in parentheses, such as `strong("a")` or `link(https://x "a")`.
 */
function describe(tokens: readonly InlineToken[]): string {
  return tokens.map(describeToken).join(' ');
}

/** One token in the notation of `describe`. */
function describeToken(token: InlineToken): string {
  switch (token.kind) {
    case 'text':
      return JSON.stringify(token.text);
    case 'break':
      return 'br';
    case 'code':
      return `code(${JSON.stringify(token.text)})`;
    case 'wikiLink':
      return `wiki(${token.target}${token.embed ? ' embed' : ''} ${JSON.stringify(token.text)})`;
    case 'link':
      return `link(${token.url}${token.title ? ` title=${JSON.stringify(token.title)}` : ''} ${describe(token.children)})`;
    case 'strong':
    case 'em':
    case 'del':
      return `${token.kind}(${describe(token.children)})`;
  }
}

/** Every link URL anywhere in the tokens. */
function linkUrls(tokens: readonly InlineToken[]): string[] {
  return tokens.flatMap((token) => {
    if (token.kind === 'link') {
      return [token.url, ...linkUrls(token.children)];
    }
    return 'children' in token ? linkUrls(token.children) : [];
  });
}

suite('Inline tokens: text and emphasis', () => {
  test('plain text is one text token, the characters other rules start at included', () => {
    assert.strictEqual(describe(tokenizeInline('Call #team/ops + @dana: 2 - 1 = 1 {ok} ^ $5 % ~')), '"Call #team/ops + @dana: 2 - 1 = 1 {ok} ^ $5 % ~"');
    assert.deepStrictEqual(tokenizeInline(''), []);
  });

  test('strong, emphasis, and strikethrough, with either marker', () => {
    assert.strictEqual(describe(tokenizeInline('**a** __b__ *c* _d_ ~~e~~')), 'strong("a") " " strong("b") " " em("c") " " em("d") " " del("e")');
  });

  test('emphasis nests', () => {
    assert.strictEqual(describe(tokenizeInline('***both***')), 'em(strong("both"))');
    assert.strictEqual(describe(tokenizeInline('*a **b** c*')), 'em("a " strong("b") " c")');
    assert.strictEqual(describe(tokenizeInline('**a *b* c**')), 'strong("a " em("b") " c")');
    assert.strictEqual(describe(tokenizeInline('~~a **b**~~')), 'del("a " strong("b"))');
  });

  test('an underscore inside a word is text, and an asterisk is not', () => {
    assert.strictEqual(describe(tokenizeInline('snake_case_name')), '"snake_case_name"');
    assert.strictEqual(describe(tokenizeInline('foo*bar*baz')), '"foo" em("bar") "baz"');
  });

  test('the rule of three keeps *foo**bar* one emphasis', () => {
    assert.strictEqual(describe(tokenizeInline('*foo**bar*')), 'em("foo**bar")');
  });

  test('unclosed and unmatched markers are text', () => {
    assert.strictEqual(describe(tokenizeInline('**open and *half')), '"**open and *half"');
    assert.strictEqual(describe(tokenizeInline('a * b * c')), '"a * b * c"');
    assert.strictEqual(describe(tokenizeInline('~one~ and ~~~three~~~')), '"~one~ and ~" del("three") "~"');
  });

  test('flanking reads punctuation and white space around a run', () => {
    assert.strictEqual(describe(tokenizeInline('"*quoted*" (*paren*)')), '"\\"" em("quoted") "\\" (" em("paren") ")"');
    assert.strictEqual(describe(tokenizeInline('*a *')), '"*a *"');
  });
});

suite('Inline tokens: code spans', () => {
  test('a code span holds its text verbatim, markers and all', () => {
    assert.strictEqual(describe(tokenizeInline('`*not em* [[x]] [l](https://x) &amp; \\*`')), 'code("*not em* [[x]] [l](https://x) &amp; \\\\*")');
  });

  test('a longer run closes only on a run as long, and one space comes off each end', () => {
    assert.strictEqual(describe(tokenizeInline('`` a`b ``')), 'code("a`b")');
    assert.strictEqual(describe(tokenizeInline('` x `')), 'code("x")');
    assert.strictEqual(describe(tokenizeInline('`  x `')), 'code(" x")');
  });

  test('an unclosed run is text, and markers after it still work', () => {
    assert.strictEqual(describe(tokenizeInline('`open *em*')), '"`open " em("em")');
  });

  test('a line break inside a code span is a space', () => {
    assert.strictEqual(describe(tokenizeInline('`a\nb`')), 'code("a b")');
  });

  test('emphasis does not reach into a code span', () => {
    assert.strictEqual(describe(tokenizeInline('*em with `code*`*')), 'em("em with " code("code*"))');
  });
});

suite('Inline tokens: links', () => {
  test('http, https, and mailto links become link tokens', () => {
    assert.strictEqual(
      describe(tokenizeInline('[a](http://x.org) [b](https://x.org/p?q=1#h) [c](mailto:a@b.co)')),
      'link(http://x.org "a") " " link(https://x.org/p?q=1#h "b") " " link(mailto:a@b.co "c")',
    );
  });

  test('a scheme is read whatever its case', () => {
    assert.strictEqual(describe(tokenizeInline('[a](HTTPS://X.ORG)')), 'link(HTTPS://X.ORG "a")');
  });

  test('a title is kept, in any of its three quotings', () => {
    assert.strictEqual(
      describe(tokenizeInline('[a](https://x "T1") [b](https://x \'T2\') [c](https://x (T3))')),
      'link(https://x title="T1" "a") " " link(https://x title="T2" "b") " " link(https://x title="T3" "c")',
    );
  });

  test('the URL is percent-encoded, keeping escapes already there', () => {
    assert.deepStrictEqual(linkUrls(tokenizeInline('[a](<https://x.org/a b>) [b](https://x.org/ü) [c](https://x.org/%20)')), [
      'https://x.org/a%20b',
      'https://x.org/%C3%BC',
      'https://x.org/%20',
    ]);
  });

  test('a host outside ASCII is written in punycode, as markdown-it normalizes it', () => {
    assert.deepStrictEqual(linkUrls(tokenizeInline('[a](https://bücher.example/ü) <https://bücher.example>')), [
      'https://xn--bcher-kva.example/%C3%BC',
      'https://xn--bcher-kva.example',
    ]);
  });

  test('a label holds inline tokens', () => {
    assert.strictEqual(describe(tokenizeInline('[**bold** `c]`](https://x)')), 'link(https://x strong("bold") " " code("c]"))');
  });

  test('links nest in emphasis and emphasis does not pair across a link edge', () => {
    assert.strictEqual(describe(tokenizeInline('*[a](https://x)*')), 'em(link(https://x "a"))');
    assert.strictEqual(describe(tokenizeInline('*[a*](https://x)')), '"*" link(https://x "a*")');
  });

  test('a link inside a label makes the outer brackets text', () => {
    assert.strictEqual(describe(tokenizeInline('[a [b](https://x) c](https://y)')), '"[a " link(https://x "b") " c](https://y)"');
  });

  test('javascript, vbscript, file, and data targets leave the whole link as text', () => {
    for (const target of ['javascript:alert(1)', 'JavaScript:x', 'vbscript:x', 'file:///etc/passwd', 'data:text/html,x']) {
      const source = `[a](${target})`;
      assert.strictEqual(describe(tokenizeInline(source)), JSON.stringify(source), target);
    }
  });

  test('any other target leaves only the words, never a link', () => {
    for (const target of ['notes/a.md', '../b.md', '#heading', '//host/path', 'ftp://x', 'obsidian://open', 'vscode:extension', 'data:image/png;base64,AA', '']) {
      const tokens = tokenizeInline(`[the *words*](${target})`);
      assert.strictEqual(describe(tokens), '"the " em("words")', target);
      assert.deepStrictEqual(linkUrls(tokens), [], target);
    }
  });

  test('a link to a note, as the sample workspace and the development notes write one, is its words', () => {
    // The only links scripts/compare-card-markdown.js finds in its corpora.
    // markdown-it drew each as an anchor the page could not follow.
    assert.strictEqual(describe(tokenizeInline('1. [Tasks](<01 Tasks.md>): due dates')), '"1. Tasks: due dates"');
    assert.strictEqual(describe(tokenizeInline('the #location/monorail [link](asdfasdf).')), '"the #location/monorail link."');
  });

  test('a link that never closes is text', () => {
    assert.strictEqual(describe(tokenizeInline('[a](https://x')), '"[a](https://x"');
    assert.strictEqual(describe(tokenizeInline('[a] (https://x)')), '"[a] (https://x)"');
    assert.strictEqual(describe(tokenizeInline('[reference][x]')), '"[reference][x]"');
  });
});

suite('Inline tokens: autolinks, images, and wiki links', () => {
  test('autolinks to the web and to mail become link tokens', () => {
    assert.strictEqual(
      describe(tokenizeInline('<https://x.org/a_b> <a.b@c.co>')),
      'link(https://x.org/a_b "https://x.org/a_b") " " link(mailto:a.b@c.co "a.b@c.co")',
    );
  });

  test('any other autolink is its words, and a refused one is text as written', () => {
    assert.strictEqual(describe(tokenizeInline('<ftp://x.org>')), '"ftp://x.org"');
    assert.strictEqual(describe(tokenizeInline('<javascript:alert(1)>')), '"<javascript:alert(1)>"');
    assert.strictEqual(describe(tokenizeInline('<not a link> <b>x</b>')), '"<not a link> <b>x</b>"');
  });

  test('an image shows nothing, as the sanitizer left nothing of one', () => {
    assert.strictEqual(describe(tokenizeInline('a ![alt *x*](pic.png "t") b')), '"a  b"');
    assert.strictEqual(describe(tokenizeInline('[![logo](l.png)](https://x)')), 'link(https://x )');
  });

  test('a wiki link or an embed is its literal text, with the note it names', () => {
    assert.strictEqual(
      describe(tokenizeInline('[[Note]] ![[Embed#Part]] [[Note|Alias]]')),
      'wiki(Note "[[Note]]") " " wiki(Embed#Part embed "![[Embed#Part]]") " " wiki(Note "[[Note|Alias]]")',
    );
  });

  test('a wiki link may sit inside emphasis, and markers inside it are its text', () => {
    assert.strictEqual(describe(tokenizeInline('**[[Note]]** [[a *b*]]')), 'strong(wiki(Note "[[Note]]")) " " wiki(a *b* "[[a *b*]]")');
  });

  test('brackets not closed on the line are text', () => {
    assert.strictEqual(describe(tokenizeInline('[[open\nclose]]')), '"[[open" br "close]]"');
  });
});

suite('Inline tokens: escapes, references, and breaks', () => {
  test('a backslash makes punctuation text and is kept before anything else', () => {
    assert.strictEqual(describe(tokenizeInline('\\*a\\* \\[b\\] \\\\ \\a \\')), '"*a* [b] \\\\ \\\\a \\\\"');
  });

  test('a backslash before a line break is a break', () => {
    assert.strictEqual(describe(tokenizeInline('a\\\nb')), '"a" br "b"');
  });

  test('named and numeric references are decoded', () => {
    assert.strictEqual(describe(tokenizeInline('&copy; &amp; &#169; &#xA9; &nbsp;|')), JSON.stringify('© & © © \u00a0|'));
  });

  test('every HTML5 name is decoded, as markdown-it decodes it', () => {
    assert.strictEqual(describe(tokenizeInline('&rarrw; &NotEqualTilde;')), JSON.stringify('\u219d \u2242\u0338'));
  });

  test('a reference that names nothing stays as written, and code 0 is U+FFFD', () => {
    assert.strictEqual(describe(tokenizeInline('&bogus; &amp &#0;')), JSON.stringify('&bogus; &amp \ufffd'));
  });

  test('a decoded marker is text, not emphasis', () => {
    assert.strictEqual(describe(tokenizeInline('&#42;a&#42;')), '"*a*"');
  });

  test('every line break is a break, without the spaces around it', () => {
    assert.strictEqual(describe(tokenizeInline('one \ntwo  \n   three\r\nfour')), '"one" br "two" br "three" br "four"');
  });

  test('HTML is text', () => {
    assert.strictEqual(describe(tokenizeInline('<script>alert(1)</script><img src=x onerror=y>')), '"<script>alert(1)</script><img src=x onerror=y>"');
  });
});
