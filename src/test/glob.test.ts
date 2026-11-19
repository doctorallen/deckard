import * as assert from 'assert';

import { compileGlobs, expandBraces, MAX_EXPANSIONS } from '../core/workspace/glob';

/** Whether the patterns match the path or any folder above it, as the exclude matcher asks. */
function excludes(patterns: readonly string[], path: string): boolean {
  const isMatch = compileGlobs(patterns);
  const segments = path.split('/');
  return segments.some((_, index) => isMatch(segments.slice(0, index + 1).join('/')));
}

/** Whether one pattern matches the whole path. */
function matches(pattern: string, path: string): boolean {
  return compileGlobs([pattern])(path);
}

suite('Glob matching in VS Code’s dialect', () => {
  test('agrees with every pattern and path decision 0013 checked picomatch on', () => {
    const settings = ['**/archive', 'drafts/*.md', 'scratch/*'];
    const cases: Array<[readonly string[], string, boolean]> = [
      [settings, 'archive/old.md', true],
      [settings, 'notes/archive/2024/old.md', true],
      [settings, '.trash/archive/old.md', true],
      [settings, 'notes/archived.md', false],
      [settings, 'drafts/idea.md', true],
      [settings, 'drafts/nested/idea.md', false],
      [settings, 'scratch/.todo.md', true],
      [settings, 'journal/today.md', false],
      [['**/archive'], 'archive/old.md', true],
      [['notes/\\[draft\\]'], 'notes/[draft]/idea.md', true],
      [['notes/\\[draft\\]'], 'notes/d/idea.md', false],
    ];
    for (const [patterns, path, expected] of cases) {
      assert.strictEqual(excludes(patterns, path), expected, `${patterns.join(', ')} on ${path}`);
    }
  });

  test('* and ? stay within a segment, and match a name that starts with a dot', () => {
    assert.ok(matches('*.md', 'idea.md'));
    assert.ok(matches('*.md', '.hidden.md'));
    assert.ok(matches('*', '.git'));
    assert.ok(!matches('*.md', 'notes/idea.md'));
    assert.ok(matches('note?.md', 'note1.md'));
    assert.ok(!matches('note?.md', 'note.md'));
    assert.ok(!matches('a?b', 'a/b'));
    assert.ok(matches('a**b', 'axxb'), '** within a segment is a plain *');
    assert.ok(!matches('a**b', 'a/x/b'));
  });

  test('** as a segment matches any number of segments, none included', () => {
    assert.ok(matches('**/archive', 'archive'));
    assert.ok(matches('**/archive', 'a/b/archive'));
    assert.ok(!matches('**/archive', 'a/archived'));
    assert.ok(matches('a/**', 'a'));
    assert.ok(matches('a/**', 'a/b/c.md'));
    assert.ok(matches('a/**/b', 'a/b'));
    assert.ok(matches('a/**/b', 'a/x/y/b'));
    assert.ok(!matches('a/**/b', 'a/x/y/c'));
    assert.ok(matches('**', 'any/path/at/all.md'));
    assert.ok(matches('**/.git', '.git'));
    assert.ok(matches('**/*.tmp', 'deep/down/.x.tmp'));
  });

  test('a pattern matches the whole path, case and all', () => {
    assert.ok(!matches('archive', 'notes/archive'));
    assert.ok(!matches('notes', 'notes/archive'));
    assert.ok(!matches('Archive', 'archive'));
    assert.ok(!matches('/archive', 'archive'), 'a leading slash is no anchor in this dialect');
  });

  test('braces offer alternatives, nested too, and stay literal without a comma or when escaped', () => {
    assert.ok(matches('**/{node_modules,.git}', 'a/node_modules'));
    assert.ok(matches('**/{node_modules,.git}', '.git'));
    assert.ok(!matches('**/{node_modules,.git}', 'a/.github'));
    assert.ok(matches('{a,{b,c}}d', 'cd'));
    assert.ok(matches('{notes,docs/drafts}/*.md', 'docs/drafts/x.md'), 'an alternative may hold a slash');
    assert.ok(matches('{a}', '{a}'));
    assert.ok(matches('\\{a,b\\}', '{a,b}'));
    assert.ok(!matches('\\{a,b\\}', 'a'));
    assert.deepStrictEqual(expandBraces('{a,b}{1,2}'), ['a1', 'a2', 'b1', 'b2']);
    assert.deepStrictEqual(expandBraces('x[{,]y'), ['x[{,]y'], 'a comma in a class is the class’s');
  });

  test('classes match one character, ranges and negation included, and never a slash', () => {
    assert.ok(matches('**/[Dd]rafts', 'notes/Drafts'));
    assert.ok(matches('**/[Dd]rafts', 'drafts'));
    assert.ok(!matches('**/[Dd]rafts', 'Xrafts'));
    assert.ok(matches('[a-c]x', 'bx'));
    assert.ok(!matches('[a-c]x', 'dx'));
    assert.ok(matches('[!a]x', 'bx'));
    assert.ok(!matches('[!a]x', 'ax'));
    assert.ok(matches('[^a]x', 'bx'));
    assert.ok(matches('[]]', ']'), 'a ] first in a class is one of its characters');
    assert.ok(matches('[abc', '[abc'), 'an unclosed [ is literal');
    assert.ok(!matches('a[!b]c', 'a/c'));
  });

  test('extglob characters and a leading ! are literal, since VS Code’s dialect has neither', () => {
    assert.ok(matches('+(a|b)', '+(a|b)'));
    assert.ok(!matches('+(a|b)', 'a'));
    assert.ok(!matches('@(x)', 'x'));
    assert.ok(!matches('!archive', 'notes'));
    assert.ok(matches('!archive', '!archive'));
  });

  test('no pattern takes long, whatever it holds or is matched against', () => {
    const long = 'a'.repeat(20_000);
    const started = Date.now();
    assert.ok(!matches('*a*a*a*a*a*a*a*a*a*a*a*a*b', long));
    assert.ok(!matches('+(a|aa)+(a|aa)+(a|aa)b', long));
    assert.ok(!matches('**/**/**/**/**/**/**/b', Array.from({ length: 2_000 }, () => 'a').join('/')));
    assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started}ms`);
    const groups = '{a,b}'.repeat(30);
    assert.strictEqual(expandBraces(groups).length, MAX_EXPANSIONS, 'braces expand at most so many ways');
  });

  test('no patterns match nothing', () => {
    assert.strictEqual(compileGlobs([])('anything'), false);
  });
});
