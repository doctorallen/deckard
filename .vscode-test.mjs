import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@vscode/test-cli';

const require = createRequire(import.meta.url);
const { listHostSuites } = require('./test/harness/importGraph.js');

/**
 * The suites that need a workspace open: where a setting is written, and
 * which value wins, depend on the workspace's settings and its folders'.
 * They live in their own folder, which listHostSuites never lists, so the
 * run without a workspace never reaches them.
 */
const SCOPE_SUITES = 'out/test/scopes/**/*.test.js';

/**
 * A single-folder and a multi-root workspace, made empty for each run, so
 * what one run wrote to a workspace's settings never reaches the next. A
 * fixed path rather than a fresh one each time, so runs leave nothing in the
 * temporary directory but this one folder.
 */
function createScopeWorkspaces() {
	const root = join(tmpdir(), 'deckard-scope-workspaces');
	rmSync(root, { recursive: true, force: true });
	for (const folder of ['single', 'first', 'second']) {
		mkdirSync(join(root, folder, 'notes'), { recursive: true });
	}
	const multiRoot = join(root, 'multi-root.code-workspace');
	writeFileSync(multiRoot, JSON.stringify({ folders: [{ path: 'first' }, { path: 'second' }], settings: {} }, null, 2));
	return { singleFolder: join(root, 'single'), multiRoot };
}

const scopeWorkspaces = createScopeWorkspaces();

/** What every run shares: the extension alone, and how long a test may wait. */
const shared = {
	launchArgs: ['--disable-extensions'],
	mocha: {
		// The suite itself runs in about four seconds, but a test that waits on
		// the editor -- a configuration change, a file read, a watcher -- waits
		// on the extension host, and a loaded CI runner stalls it well past
		// Mocha's two-second default. A longer limit still catches a test that
		// has genuinely hung, without failing one that was only waiting for a
		// busy machine.
		timeout: 20000,
		// On CI a `.only` left in a suite fails the run, rather than quietly
		// running that one test and passing.
		forbidOnly: Boolean(process.env.CI),
	},
};

export default defineConfig([
	{
		label: 'host',
		// Every suite that reaches `vscode`. The ones that never do run under
		// plain mocha in `npm run test:unit`, which `pretest` runs first; the
		// import graph decides which is which.
		files: listHostSuites(),
		...shared,
	},
	{
		label: 'single-folder',
		files: SCOPE_SUITES,
		workspaceFolder: scopeWorkspaces.singleFolder,
		...shared,
	},
	{
		label: 'multi-root',
		files: SCOPE_SUITES,
		workspaceFolder: scopeWorkspaces.multiRoot,
		...shared,
	},
]);
