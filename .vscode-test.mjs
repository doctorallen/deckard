import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
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
