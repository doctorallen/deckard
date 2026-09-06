import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const themesSource = readFileSync(
  resolve(repositoryRoot, 'src/ui/webview/themes.ts'),
  'utf8',
);
const manifest = themesSource.match(
  /export const deckardThemes = \[([\s\S]*?)\] as const;/,
);

if (!manifest) {
  throw new Error('Could not read the deckardThemes manifest.');
}

const themes = [...manifest[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
if (themes.length === 0) {
  throw new Error('The deckardThemes manifest does not contain any themes.');
}

const build = spawnSync(process.execPath, ['esbuild.js'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
if (build.status !== 0) {
  throw new Error('Extension build failed');
}

for (const theme of themes) {
  console.log(`Capturing ${theme} Dashboard...`);
  execFileSync(process.execPath, ['scripts/capture-dashboard-screenshot.mjs'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DECKARD_SCREENSHOT_PROMOTE: '1',
      DECKARD_SCREENSHOT_SKIP_BUILD: '1',
      DECKARD_SCREENSHOT_THEME: theme,
      DECKARD_SCREENSHOT_OUTPUT: `docs/images/dashboard-${theme}.png`,
    },
  });
}
