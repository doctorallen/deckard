import { createRequire } from 'node:module';

import { defineConfig } from '@vscode/test-cli';

const require = createRequire(import.meta.url);
const { listHostSuites } = require('./test/harness/importGraph.js');

export default defineConfig({
	// Every suite that reaches `vscode`. The ones that never do run under
	// plain mocha in `npm run test:unit`, which `pretest` runs first; the
	// import graph decides which is which.
	files: listHostSuites(),
	launchArgs: ['--disable-extensions'],
	mocha: {
		// The suite itself runs in about four seconds, but a test that waits on
		// the editor -- a configuration change, a file read, a watcher -- waits
		// on the extension host, and a loaded CI runner stalls it well past
		// Mocha's two-second default. A longer limit still catches a test that
		// has genuinely hung, without failing one that was only waiting for a
		// busy machine.
		timeout: 20000,
	},
});
