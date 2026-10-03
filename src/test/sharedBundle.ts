import * as path from 'path';

// esbuild's main module by its path: dependency-cruiser reads a bare
// 'esbuild' as the repository's own esbuild.js, which imports itself.
import { buildSync } from 'esbuild/lib/main';

/** The repository, which the page code's imports resolve from. */
const ROOT = path.join(__dirname, '..', '..');

/**
 * Modules of the pages' shared core (`src/webview/shared`), bundled as one
 * script for a test page, built as esbuild builds a page. Run in a page, it
 * sets `window.shared` to every export of the modules named, with Preact's
 * `h`, `render`, and `Fragment`, so a suite can draw a component on its own
 * without a page that draws it.
 * @param modules The modules' names under `src/webview/shared`, without extension.
 */
export function bundleShared(modules: readonly string[]): string {
  const contents = [
    "export { Fragment, h, render } from 'preact';",
    ...modules.map((name) => `export * from './src/webview/shared/${name}';`),
  ].join('\n');
  const result = buildSync({
    stdin: { contents, resolveDir: ROOT, loader: 'ts', sourcefile: 'shared-under-test.ts' },
    bundle: true,
    format: 'iife',
    globalName: 'shared',
    platform: 'browser',
    target: 'chrome148',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}
