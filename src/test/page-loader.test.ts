import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { loadPage, readPageNonce, resolveAsset } from '../../test/harness/loadPage';

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src vscode-webview://deckard 'nonce-abc'; script-src 'nonce-abc';">`;

suite('Page loader', () => {
  let root: string;

  setup(() => {
    root = mkdtempSync(path.join(tmpdir(), 'deckard-page-loader-'));
    mkdirSync(path.join(root, 'dist', 'webview'), { recursive: true });
    writeFileSync(path.join(root, 'dist', 'webview', 'stats.js'), 'window.drawn = true;');
    writeFileSync(path.join(root, 'dist', 'webview', 'stats.css'), 'body { color: red; }');
  });

  teardown(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('leaves a page that loads nothing unchanged', () => {
    const html = `<html><head>${CSP}<style nonce="abc">p {}</style></head><body><script nonce="abc">run();</script></body></html>`;
    assert.strictEqual(loadPage(html, { root }), html);
  });

  test('inlines a bundle and its style sheet with the page nonce', () => {
    const html = `<html><head>${CSP}<link rel="stylesheet" href="vscode-webview://deckard/dist/webview/stats.css"></head>`
      + `<body><script nonce="abc" src="vscode-webview://deckard/dist/webview/stats.js"></script></body></html>`;
    const loaded = loadPage(html, { root });
    assert.ok(
      loaded.includes('<style nonce="abc" data-inlined-from="vscode-webview://deckard/dist/webview/stats.css">body { color: red; }</style>'),
      loaded,
    );
    assert.ok(
      loaded.includes('<script nonce="abc" data-inlined-from="vscode-webview://deckard/dist/webview/stats.js">window.drawn = true;</script>'),
      loaded,
    );
    assert.ok(!loaded.includes('src='), 'no script is left to fetch');
  });

  test('takes the nonce from the policy when the tag has none', () => {
    const html = `${CSP}<script src="dist/webview/stats.js"></script>`;
    assert.strictEqual(
      loadPage(html, { root }),
      `${CSP}<script nonce="abc" data-inlined-from="dist/webview/stats.js">window.drawn = true;</script>`,
    );
    assert.strictEqual(readPageNonce(html), 'abc');
  });

  test('keeps the other attributes a script carries', () => {
    const html = `${CSP}<script type="module" src="dist/webview/stats.js"></script>`;
    assert.ok(loadPage(html, { root }).includes('<script nonce="abc" type="module" data-inlined-from="dist/webview/stats.js">'));
  });

  test('admits an inlined sheet by the page nonce, as its policy admitted the link by origin', () => {
    const policy = (sources: string) => `<meta http-equiv="Content-Security-Policy" content="${sources}">`;
    const link = '<link rel="stylesheet" href="vscode-webview://deckard/dist/webview/stats.css">';
    assert.strictEqual(
      loadPage(`${policy("default-src 'none'; style-src vscode-webview://deckard; script-src 'nonce-abc';")}${link}`, { root }),
      `${policy("default-src 'none'; style-src vscode-webview://deckard 'nonce-abc'; script-src 'nonce-abc';")}`
        + '<style nonce="abc" data-inlined-from="vscode-webview://deckard/dist/webview/stats.css">body { color: red; }</style>',
    );
    assert.strictEqual(
      loadPage(`${policy("default-src 'none'; style-src vscode-webview://deckard;")}${link}`, { root }),
      `${policy("default-src 'none'; style-src vscode-webview://deckard 'nonce-deckardPageLoader';")}`
        + '<style nonce="deckardPageLoader" data-inlined-from="vscode-webview://deckard/dist/webview/stats.css">body { color: red; }</style>',
      'a page with no nonce is given the loader\'s',
    );
    assert.strictEqual(
      loadPage(`${policy("default-src 'none'; style-src https://example.com; script-src 'nonce-abc';")}${link}`, { root }),
      `${policy("default-src 'none'; style-src https://example.com; script-src 'nonce-abc';")}`
        + '<style data-inlined-from="vscode-webview://deckard/dist/webview/stats.css">body { color: red; }</style>',
      'a sheet the policy does not admit is inlined with no nonce, so Chrome blocks it as VS Code would',
    );
  });

  test('resolves a url() in a sheet against the sheet, as the browser does', () => {
    writeFileSync(
      path.join(root, 'dist', 'webview', 'stats.css'),
      '.a { mask: url("../../resources/heart.svg"); } .b { background: url(data:image/png;base64,AA) } .c { mask: url(\'https://example.com/x.svg\') }',
    );
    const loaded = loadPage(`${CSP}<link rel="stylesheet" href="vscode-webview://deckard/dist/webview/stats.css">`, { root });
    assert.ok(loaded.includes('.a { mask: url("vscode-webview://deckard/resources/heart.svg"); }'), loaded);
    assert.ok(loaded.includes('url(data:image/png;base64,AA)'), 'a data URI is left alone');
    assert.ok(loaded.includes("url('https://example.com/x.svg')"), 'an absolute URI is left alone');
  });

  test('resolves VS Code webview URIs and the stand-in harnesses use', () => {
    assert.strictEqual(resolveAsset('vscode-webview://deckard/dist/webview/a.js', '/ext'), path.join('/ext', 'dist/webview/a.js'));
    assert.strictEqual(
      resolveAsset('https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/a.js', '/elsewhere'),
      path.join('/', 'ext/dist/webview/a.js'),
    );
    assert.strictEqual(resolveAsset('https://example.com/a.js', '/ext'), undefined);
  });

  test('fails loudly for an asset it cannot read', () => {
    assert.throws(() => loadPage('<script src="dist/webview/missing.js"></script>', { root }), /not built/);
    assert.throws(() => loadPage('<script src="https://example.com/a.js"></script>', { root }), /outside the extension/);
    writeFileSync(path.join(root, 'dist', 'webview', 'closes.js'), 'const s = "</script>";');
    assert.throws(() => loadPage('<script src="dist/webview/closes.js"></script>', { root }), /cannot be inlined/);
  });
});
