import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Flat cards part their rows with `--divider`, and tags drawn as text take
 * `--tag-text`. Borders are decoration to the contrast check, so these two
 * are held here instead: in every theme, against every surface a row or a
 * tag sits on, the divider reaches 3:1 (a non-text edge) and the tag 4.5:1
 * (text). Mimic, and Corpo with it, is read through VS Code's Dark 2026
 * and Light 2026 palettes, the two the contrast and layout checks draw with.
 */

const ROOT = path.join(__dirname, '..', '..');
const SHARED = path.join(ROOT, 'src', 'webview', 'shared');

/** The surfaces a row or a tag is drawn on. */
const SURFACES = ['bg', 'panel', 'panel-raised', 'panel-deep'];

/**
 * VS Code's colors in Dark 2026 and Light 2026, as Corpo pins them, by theme
 * kind: the palettes Mimic is read through, as test/ui/pages.js reads them.
 */
function readPalettes(): Record<string, Record<string, string>> {
  const css = fs.readFileSync(path.join(SHARED, 'themes', 'corpo.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const palettes: Record<string, Record<string, string>> = {};
  for (const [, kind, body] of css.matchAll(/:root:has\(> body\.vscode-(dark|light)\)\s*\{([^}]*)\}/g)) {
    palettes[kind] = {};
    for (const [, token, value] of body.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;!]+?)\s*!important\s*;/g)) {
      if (value !== 'initial') {
        palettes[kind][token] = value;
      }
    }
  }
  return palettes;
}

const PALETTES = readPalettes();

/** A sheet's `:root` custom properties, by name. */
function readTokens(file: string): Record<string, string> {
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  const tokens: Record<string, string> = {};
  for (const match of (root ? root[1] : '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

/** A color written as a hex, a var() chain, or a color-mix of two, as sRGB channels. */
function resolve(value: string, tokens: Record<string, string>, depth = 0): [number, number, number] {
  assert.ok(depth < 10, `${value} does not resolve`);
  const text = value.trim();
  const translucent = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(text);
  if (translucent) {
    // A see-through VS Code color, such as Dark 2026's hover, over the editor's ground.
    const alpha = parseInt(translucent[2], 16) / 255;
    const over = resolve('var(--vscode-editor-background)', tokens, depth + 1);
    const color = resolve(`#${translucent[1]}`, tokens, depth + 1);
    return color.map((channel, at) => Math.round(channel * alpha + over[at] * (1 - alpha))) as [number, number, number];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((digit) => digit + digit).join('') : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
  }
  const variable = /^var\((--[\w-]+)(?:,\s*([\s\S]+))?\)$/.exec(text);
  if (variable) {
    const next = tokens[variable[1]] ?? variable[2];
    assert.ok(next, `${variable[1]} is not set`);
    return resolve(next, tokens, depth + 1);
  }
  const mix = /^color-mix\(in srgb,\s*([\s\S]+?)\s+(\d+)%,\s*([\s\S]+)\)$/.exec(text);
  if (mix) {
    const share = Number(mix[2]) / 100;
    const first = resolve(mix[1], tokens, depth + 1);
    const second = resolve(mix[3], tokens, depth + 1);
    return first.map((channel, at) => Math.round(channel * share + second[at] * (1 - share))) as [number, number, number];
  }
  throw new Error(`cannot read ${text}`);
}

function luminance([red, green, blue]: [number, number, number]): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(first: [number, number, number], second: [number, number, number]): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Each theme's tokens over the base sheet's, Mimic and Corpo once per VS Code palette. */
function themes(): Array<[string, Record<string, string>]> {
  const base = readTokens(path.join(SHARED, 'designTokens.css'));
  const named = fs.readdirSync(path.join(SHARED, 'themes')).filter((file) => file.endsWith('.css'));
  const out: Array<[string, Record<string, string>]> = [['replicant (base)', base]];
  for (const file of named) {
    const tokens = { ...base, ...readTokens(path.join(SHARED, 'themes', file)) };
    if (file === 'mimic.css') {
      // Corpo is Mimic over its own palettes, which are the ones Mimic is read through.
      for (const name of ['mimic', 'corpo']) {
        out.push([`${name} dark`, { ...tokens, ...PALETTES.dark }], [`${name} light`, { ...tokens, ...PALETTES.light }]);
      }
    } else if (file !== 'replicant.css' && file !== 'corpo.css') {
      out.push([file.replace('.css', ''), tokens]);
    }
  }
  return out;
}

suite('Display tokens: flat rows and text tags', () => {
  test('a flat row\'s divider reaches 3:1 against every surface in every theme', () => {
    for (const [name, tokens] of themes()) {
      for (const surface of SURFACES) {
        const ratio = contrast(resolve('var(--divider)', tokens), resolve(`var(--${surface})`, tokens));
        assert.ok(ratio >= 3, `${name}: --divider on --${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test('a tag drawn as text, its name and its namespace, reaches 4.5:1 against every surface in every theme', () => {
    for (const [name, tokens] of themes()) {
      for (const token of ['tag-text', 'tag-namespace']) {
        for (const surface of SURFACES) {
          const ratio = contrast(resolve(`var(--${token})`, tokens), resolve(`var(--${surface})`, tokens));
          assert.ok(ratio >= 4.5, `${name}: --${token} on --${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });
});
