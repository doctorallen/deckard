import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const views = ['dashboard', 'related-notes', 'tag-overview', 'help', 'stats'];

const build = spawnSync(process.execPath, ['esbuild.js'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
if (build.status !== 0) {
  throw new Error('Extension build failed');
}

for (const view of views) {
  console.log(`Capturing ${view} screenshot...`);
  execFileSync(process.execPath, ['scripts/capture-dashboard-screenshot.mjs'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DECKARD_SCREENSHOT_PROMOTE: '1',
      DECKARD_SCREENSHOT_SKIP_BUILD: '1',
      DECKARD_SCREENSHOT_VIEW: view,
    },
  });
}
