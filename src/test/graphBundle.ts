import * as path from 'path';

// esbuild's main module by its path: dependency-cruiser reads a bare
// 'esbuild' as the repository's own esbuild.js, which imports itself.
import { buildSync } from 'esbuild/lib/main';

/** The repository, which the page code's imports resolve from. */
const ROOT = path.join(__dirname, '..', '..');

/**
 * Modules of the Notes Graph's page (`src/webview/notesGraph`), bundled as
 * esbuild builds a page and run here, in the test's own realm, so a suite
 * can call them with no page around them. Returns every export of the
 * modules named.
 * @param modules The modules' names under `src/webview/notesGraph`, without extension.
 */
export function loadGraphModules<T>(modules: readonly string[]): T {
  const contents = modules.map((name) => `export * from './src/webview/notesGraph/${name}';`).join('\n');
  const result = buildSync({
    stdin: { contents, resolveDir: ROOT, loader: 'ts', sourcefile: 'graph-under-test.ts' },
    bundle: true,
    format: 'iife',
    globalName: 'graphUnderTest',
    platform: 'browser',
    target: 'chrome148',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    write: false,
    logLevel: 'silent',
  });
  return new Function(`${result.outputFiles[0].text}\nreturn graphUnderTest;`)() as T;
}
