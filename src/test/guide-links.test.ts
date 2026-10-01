import * as assert from 'assert';

import { GUIDE_IMAGE_BASE, resolveGuideLink, rewriteGuideHtml } from '../ui/webview/pages/help/guideLinks';

/**
 * What `markdown.api.render` returned for a short page in VS Code 1.140: the
 * Mermaid span first, each block marked with its line, and each link
 * repeating its target in `data-href`.
 */
const RENDERED = [
  '<span id="markdown-mermaid" aria-hidden="true" data-config="{&quot;darkModeTheme&quot;:&quot;vscode&quot;}"></span>',
  '\t\t\t\t<h1 data-line="0" class="code-line" dir="auto" id="tasks">Tasks</h1>',
  '<h2 data-line="2" class="code-line" dir="auto" id="task-metadata">Task metadata</h2>',
  '<p data-line="4" class="code-line" dir="auto">See <a href="task-board.md#group-by-tag" data-href="task-board.md#group-by-tag">the board</a>, ' +
    '<a href="#task-metadata" data-href="#task-metadata">below</a>, <a href="../../CHANGELOG.md" data-href="../../CHANGELOG.md">the changelog</a>, ' +
    '<a href="../../LICENSE" data-href="../../LICENSE">the license</a>, and ' +
    '<a href="https://example.com/a?b=1&amp;c=2" title="T" data-href="https://example.com/a?b=1&amp;c=2">the web</a>.</p>',
  '<p data-line="6" class="code-line" dir="auto"><img src="../images/task-board.png" alt="The board." data-src="../images/task-board.png"></p>',
  '<table data-line="8" class="code-line" dir="auto"><tbody><tr><td><img src="../images/agenda.png" alt="Tasks view." width="220"></td></tr></tbody></table>',
  '<pre><code data-line="10" class="code-line language-ts" dir="auto"><span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span>;\n</code></pre>',
].join('\n');

suite('Guide links', () => {
  test('a link stays in the panel, or goes to GitHub, with only the attributes the panel gives it', () => {
    const html = rewriteGuideHtml(RENDERED);
    assert.ok(html.includes('<a href="#" data-guide-page="task-board" data-guide-anchor="group-by-tag">the board</a>'));
    assert.ok(html.includes('<a href="#" data-guide-anchor="task-metadata">below</a>'));
    assert.ok(html.includes('<a href="#" data-action="open-changelog">the changelog</a>'));
    assert.ok(html.includes('<a href="https://github.com/doctorallen/deckard/blob/master/LICENSE">the license</a>'));
    assert.ok(html.includes('<a href="https://example.com/a?b=1&amp;c=2">the web</a>'), 'its entities read back and written again');
    assert.ok(!html.includes('data-href'), 'no link keeps the target it was written with');
  });

  test('a screenshot loads from GitHub, in Markdown or in the guide’s own HTML', () => {
    const html = rewriteGuideHtml(RENDERED);
    assert.ok(html.includes(`<img src="${GUIDE_IMAGE_BASE}task-board.png" alt="The board.">`));
    assert.ok(html.includes(`<img src="${GUIDE_IMAGE_BASE}agenda.png" alt="Tasks view." width="220">`));
    assert.ok(!html.includes('data-src'));
  });

  test('the Mermaid span goes, and the engine’s marks are left as they came', () => {
    const html = rewriteGuideHtml(RENDERED);
    assert.ok(!html.includes('markdown-mermaid'));
    assert.ok(html.startsWith('<h1 data-line="0" class="code-line" dir="auto" id="tasks">Tasks</h1>'), 'nor the space after it');
    assert.ok(html.includes('<h2 data-line="2" class="code-line" dir="auto" id="task-metadata">'));
    assert.ok(html.includes('<span class="hljs-keyword">const</span>'));
  });

  test('says where each kind of link points from the panel', () => {
    assert.deepStrictEqual(resolveGuideLink('tasks.md'), { kind: 'page', page: 'tasks' });
    assert.deepStrictEqual(resolveGuideLink('./tasks.md#task-metadata'), { kind: 'page', page: 'tasks', anchor: 'task-metadata' });
    assert.deepStrictEqual(resolveGuideLink('#zen-mode'), { kind: 'anchor', anchor: 'zen-mode' });
    assert.deepStrictEqual(resolveGuideLink('../../CHANGELOG.md'), { kind: 'changelog' });
    assert.deepStrictEqual(resolveGuideLink('mailto:a@example.com'), { kind: 'external', href: 'mailto:a@example.com' });
    assert.deepStrictEqual(resolveGuideLink('no-such-page.md'), {
      kind: 'external',
      href: 'https://github.com/doctorallen/deckard/blob/master/docs/guide/no-such-page.md',
    });
    assert.deepStrictEqual(resolveGuideLink('../architecture/README.md#layers'), {
      kind: 'external',
      href: 'https://github.com/doctorallen/deckard/blob/master/docs/architecture/README.md#layers',
    });
  });
});
