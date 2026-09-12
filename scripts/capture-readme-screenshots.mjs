import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const views = ['dashboard', 'related-notes', 'tag-overview', 'help'];
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

const argumentsAfterScript = process.argv.slice(2);
let requestedTheme;
if (argumentsAfterScript.length === 1) {
  requestedTheme = argumentsAfterScript[0].startsWith('--theme=')
    ? argumentsAfterScript[0].slice('--theme='.length)
    : argumentsAfterScript[0];
} else if (
  argumentsAfterScript.length === 2 &&
  argumentsAfterScript[0] === '--theme'
) {
  requestedTheme = argumentsAfterScript[1];
} else if (argumentsAfterScript.length > 0) {
  throw new Error(
    'Usage: npm run capture:readme-screenshots -- <theme>',
  );
}

const theme =
  requestedTheme ?? process.env.DECKARD_SCREENSHOT_THEME ?? 'replicant';
if (!themes.includes(theme)) {
  throw new Error(
    `Unknown screenshot theme "${theme}". Choose one of: ${themes.join(', ')}.`,
  );
}

const build = spawnSync(process.execPath, ['esbuild.js'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
if (build.status !== 0) {
  throw new Error('Extension build failed');
}

console.log(`Capturing README screenshots with the ${theme} theme...`);
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
      DECKARD_SCREENSHOT_THEME: theme,
    },
  });
}
