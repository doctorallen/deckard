import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');

interface Keybinding {
  command: string;
  key: string;
  mac?: string;
  linux?: string;
  win?: string;
}

/**
 * VS Code's own default shortcuts in the Cmd/Ctrl+Shift+Alt+letter family
 * Deckard's shortcuts use, with the platforms each is bound on, as of
 * VS Code 1.136. Found by searching its workbench bundle for those chords'
 * key codes (Cmd/Ctrl, Shift, and Alt are 3584, plus 31 for A through 56
 * for Z) wherever a keybinding names one, alone or as either half of a
 * two-key chord, and its built-in extensions' manifests for the same
 * chords written out.
 */
const VS_CODE_DEFAULTS: ReadonlyArray<{ letter: string; platforms: readonly Platform[]; command: string }> = [
  { letter: 'a', platforms: ['mac', 'linux', 'win'], command: 'Open Agents Window' },
  { letter: 'c', platforms: ['mac', 'linux'], command: 'Copy Relative Path of Active File' },
  { letter: 'g', platforms: ['mac', 'linux', 'win'], command: 'Announce Cursor Position' },
  { letter: 'i', platforms: ['linux'], command: 'Open Chat (Agent)' },
  { letter: 'l', platforms: ['mac', 'linux', 'win'], command: 'Open Quick Chat' },
  { letter: 'o', platforms: ['mac', 'linux', 'win'], command: 'Focus Most Recent Chat Terminal Output' },
];

type Platform = 'mac' | 'linux' | 'win';

/** A chord with its keys in one order, so `shift+cmd+alt+c` and `cmd+shift+alt+c` compare equal. */
function normalize(chord: string): string {
  return chord.toLowerCase().split('+').sort().join('+');
}

/** The chord a binding has on a platform, as VS Code chooses it. */
function chordOn(binding: Keybinding, platform: Platform): string {
  return normalize(binding[platform] ?? binding.key);
}

suite('Manifest keybindings', () => {
  test("no shortcut takes over one of VS Code's own defaults", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: { keybindings: Keybinding[] };
    };
    const platforms = ['mac', 'linux', 'win'] as const;
    const taken = manifest.contributes.keybindings.flatMap((binding) =>
      platforms.flatMap((platform) => {
        const modifier = platform === 'mac' ? 'cmd' : 'ctrl';
        return VS_CODE_DEFAULTS.filter(
          (own) =>
            own.platforms.includes(platform) &&
            chordOn(binding, platform) === normalize(`${modifier}+shift+alt+${own.letter}`),
        ).map((own) => `${binding.command} takes ${own.command} on ${platform}`);
      }),
    );
    assert.deepStrictEqual(taken, []);
  });
});
