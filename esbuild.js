// Builds the extension host and the webview pages.
//
//   node esbuild.js               both, for development, with source maps
//   node esbuild.js --production  both, minified, as the VSIX ships them
//   node esbuild.js --webview     the pages alone (npm run build:webview)
//   node esbuild.js --watch       both, rebuilt on every change
//
// The host is one Node bundle per entry under dist/. The pages are browser
// bundles under dist/webview/: a script and a style sheet per page, a sheet
// per theme, and the tail every page lays over its theme
// (docs/architecture/webviews.md). Each build writes what went into it to
// out/extension-meta.json or out/webview-meta.json, which
// scripts/check-bundle-inputs.js reads; out/ never ships.
const esbuild = require("esbuild");
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const webviewOnly = process.argv.includes('--webview');

/** Where the page code lives: one folder per page, beside `shared`. */
const WEBVIEW_SOURCE = path.join('src', 'webview');
/** Where the pages are built to, which the webviews' `localResourceRoots` names. */
const WEBVIEW_OUT = path.join('dist', 'webview');
/**
 * The Chromium the oldest supported VS Code draws pages with: 1.134, the
 * engine package.json requires, runs Electron 42, which is Chrome 148.
 */
const WEBVIEW_TARGET = 'chrome148';

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Writes a build's metafile to out/ after each build, so the bundle-inputs
 * check reads what the last build took in.
 *
 * @param {string} file The metafile's name under out/.
 * @returns {import('esbuild').Plugin} The plugin.
 */
function writeMetafile(file) {
	return {
		name: 'write-metafile',
		setup(build) {
			build.onEnd((result) => {
				if (!result.metafile) {
					return;
				}
				fs.mkdirSync('out', { recursive: true });
				fs.writeFileSync(path.join('out', file), JSON.stringify(result.metafile, null, 1));
			});
		},
	};
}

/**
 * The files in a folder that pass `keep`, or none when there is no folder.
 *
 * @param {string} folder The folder to list.
 * @param {(name: string) => boolean} keep Which file names to take.
 * @returns {string[]} Their paths, sorted.
 */
function listFiles(folder, keep) {
	if (!fs.existsSync(folder)) {
		return [];
	}
	return fs.readdirSync(folder, { withFileTypes: true })
		.filter((entry) => entry.isFile() && keep(entry.name))
		.map((entry) => path.join(folder, entry.name))
		.sort();
}

/**
 * Every page entry, found rather than listed, so adding a page edits no
 * build file. Each folder of src/webview but `shared` gives its `main.ts`
 * or `main.tsx` as `<page>.js` and its `page.css` as `<page>.css`; each
 * sheet in `shared/themes` gives `themes/<theme>.css`; and `shared/tail.css`
 * gives `tail.css`.
 *
 * @returns {{ in: string, out: string }[]} Each entry's source and output name.
 */
function webviewEntries() {
	const pages = fs.existsSync(WEBVIEW_SOURCE)
		? fs.readdirSync(WEBVIEW_SOURCE, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name !== 'shared')
			.map((entry) => entry.name)
			.sort()
		: [];
	const pageEntries = pages.flatMap((page) =>
		listFiles(path.join(WEBVIEW_SOURCE, page), (name) => /^(main\.tsx?|page\.css)$/.test(name))
			.map((file) => ({ in: file, out: page })),
	);
	const themes = listFiles(path.join(WEBVIEW_SOURCE, 'shared', 'themes'), (name) => name.endsWith('.css'))
		.map((file) => ({ in: file, out: `themes/${path.basename(file, '.css')}` }));
	const tail = listFiles(path.join(WEBVIEW_SOURCE, 'shared'), (name) => name === 'tail.css')
		.map((file) => ({ in: file, out: 'tail' }));
	return [...pageEntries, ...themes, ...tail];
}

/** The extension host's build: Node bundles under dist/. */
function extensionContext() {
	return esbuild.context({
		// The search index worker is its own bundle: a worker thread is
		// started from a file path, and it has no VS Code to import.
		entryPoints: [
			'src/extension.ts',
			'src/core/storage/searchStoreWorker.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outdir: 'dist',
		entryNames: '[name]',
		external: ['vscode'],
		metafile: true,
		logLevel: 'silent',
		plugins: [
			writeMetafile('extension-meta.json'),
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
}

/**
 * The pages' build: browser bundles and style sheets under dist/webview/.
 * A sheet names a file of the extension in `url()` by its path from
 * dist/webview/, where the sheet is served from, so that path is left as
 * written rather than bundled.
 *
 * @param {{ in: string, out: string }[]} entries What to build.
 */
function webviewContext(entries) {
	return esbuild.context({
		entryPoints: entries,
		bundle: true,
		format: 'iife',
		platform: 'browser',
		target: WEBVIEW_TARGET,
		jsx: 'automatic',
		jsxImportSource: 'preact',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		outdir: WEBVIEW_OUT,
		external: ['../../resources/*'],
		metafile: true,
		logLevel: 'silent',
		plugins: [
			writeMetafile('webview-meta.json'),
			esbuildProblemMatcherPlugin,
		],
	});
}

/**
 * The pages' build, or none while there is no page to build, when the
 * metafile records an empty build so the check still has one to read. The
 * output folder starts empty, so a page that was removed leaves no bundle
 * behind for a harness to load.
 */
async function createWebviewContext() {
	fs.rmSync(WEBVIEW_OUT, { recursive: true, force: true });
	const entries = webviewEntries();
	if (entries.length) {
		return webviewContext(entries);
	}
	fs.mkdirSync('out', { recursive: true });
	fs.writeFileSync(path.join('out', 'webview-meta.json'), JSON.stringify({ inputs: {}, outputs: {} }, null, 1));
	console.log('[webview] no page entries in src/webview, so there is nothing to build');
	return undefined;
}

async function main() {
	const contexts = [
		...(webviewOnly ? [] : [await extensionContext()]),
		await createWebviewContext(),
	].filter(Boolean);
	if (watch) {
		await Promise.all(contexts.map((ctx) => ctx.watch()));
		return;
	}
	for (const ctx of contexts) {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
