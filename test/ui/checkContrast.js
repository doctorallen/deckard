// Checks the contrast of every Deckard surface, in every theme, including the
// states a pointer or the keyboard puts a control into.
//
// Hover is where contrast breaks in this codebase, because a hover is usually
// written as two rules: one flips a control's background, another colors the
// control or something inside it. Each rule is fine on its own, and the pair
// is unreadable. A theme then re-declares the tokens underneath both, so the
// same pair reads differently in every theme.
//
// This renders each page for each theme, resolves the design tokens, and works
// out what color sits on what background for a control at rest, hovered,
// active, and focused — including the text of its descendants, which is what
// a hover background strands.
//
//   npm run test:contrast
const { renderPagesForTheme, themes } = require('./pages.js');

/** WCAG AA: 4.5:1 for body text, 3:1 for large text and UI edges. */
const TEXT_RATIO = 4.5;
const LARGE_TEXT_RATIO = 3;

/** Colors these tokens stand for while a theme follows VS Code's own. */
const VSCODE_PALETTES = {
  dark: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-input-background': '#313131',
    '--vscode-list-hoverBackground': '#2a2d2e',
    '--vscode-foreground': '#cccccc',
    '--vscode-descriptionForeground': '#9d9d9d',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-charts-green': '#89d185',
    '--vscode-charts-red': '#f14c4c',
    '--vscode-charts-orange': '#d18616',
    '--vscode-charts-yellow': '#cca700',
    '--vscode-charts-blue': '#3794ff',
    '--vscode-panel-border': '#2b2b2b',
    '--vscode-widget-border': '#313131',
    '--vscode-button-background': '#0078d4',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#026ec1',
    '--vscode-button-border': '#ffffff12',
    '--vscode-button-secondaryBackground': '#313131',
    '--vscode-button-secondaryForeground': '#cccccc',
    '--vscode-button-secondaryHoverBackground': '#3c3c3c',
    '--vscode-input-foreground': '#cccccc',
    '--vscode-input-border': '#3c3c3c',
    '--vscode-input-placeholderForeground': '#989898',
    '--vscode-dropdown-background': '#313131',
    '--vscode-dropdown-border': '#3c3c3c',
    '--vscode-sideBar-background': '#181818',
    '--vscode-editorWidget-foreground': '#cccccc',
    '--vscode-editorWarning-foreground': '#cca700',
    '--vscode-widget-shadow': '#0000005c',
    '--vscode-editor-font-family': 'monospace',
    '--vscode-font-family': 'sans-serif',
  },
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-input-background': '#ffffff',
    '--vscode-list-hoverBackground': '#e8e8e8',
    '--vscode-foreground': '#3b3b3b',
    '--vscode-descriptionForeground': '#717171',
    '--vscode-textLink-foreground': '#005fb8',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-charts-green': '#388a34',
    '--vscode-charts-red': '#a1260d',
    '--vscode-charts-orange': '#d18616',
    '--vscode-charts-yellow': '#b89500',
    '--vscode-charts-blue': '#0f4a85',
    '--vscode-panel-border': '#e5e5e5',
    '--vscode-widget-border': '#d4d4d4',
    '--vscode-button-background': '#005fb8',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#0258a8',
    '--vscode-button-border': '#0000001a',
    '--vscode-button-secondaryBackground': '#e5e5e5',
    '--vscode-button-secondaryForeground': '#3b3b3b',
    '--vscode-button-secondaryHoverBackground': '#cccccc',
    '--vscode-input-foreground': '#3b3b3b',
    '--vscode-input-border': '#cecece',
    '--vscode-input-placeholderForeground': '#767676',
    '--vscode-dropdown-background': '#ffffff',
    '--vscode-dropdown-border': '#cecece',
    '--vscode-sideBar-background': '#f8f8f8',
    '--vscode-editorWidget-foreground': '#3b3b3b',
    '--vscode-editorWarning-foreground': '#bf8803',
    '--vscode-widget-shadow': '#00000029',
    '--vscode-editor-font-family': 'monospace',
    '--vscode-font-family': 'sans-serif',
  },
};

/** Text that is 16px or larger, or bold at 14px, only needs 3:1. */
const LARGE_TEXT_KEYS = new Set([
  'h1',
  'h2',
  '.metric-value',
  '.count',
  '.board-count',
  '.tag-count',
]);

/** Surfaces whose color is decoration rather than text to read. */
const DECORATIVE = [
  '::before',
  '::after',
  'border-color',
  'outline-color',
  '.tag-weight-rail-segment',
  '.note-dot',
  '.legend-swatch',
  '.home-widget-grip',
  '.board-status-grip',
  '.query-chip-remove',
  '.hub-toggle',
];

// ---- CSS ------------------------------------------------------------------

/** Strips comments and pulls every rule out, flattening @media blocks. */
function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('{', index);
    if (open < 0) break;
    const prelude = text.slice(index, open).trim();
    if (prelude.startsWith('@')) {
      // A block at-rule holds rules of its own; a statement one has no body.
      const blockEnd = matchBrace(text, open);
      if (/^@(media|supports|layer|container)/.test(prelude)) {
        rules.push(...parseRules(text.slice(open + 1, blockEnd)));
      }
      index = blockEnd + 1;
      continue;
    }
    const close = matchBrace(text, open);
    const body = text.slice(open + 1, close);
    rules.push({ selectors: splitSelectors(prelude), declarations: parseDeclarations(body) });
    index = close + 1;
  }
  return rules;
}

function matchBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

/** Splits on commas that are not inside brackets. */
function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of prelude) {
    if (character === '(' || character === '[') depth += 1;
    if (character === ')' || character === ']') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseDeclarations(body) {
  const declarations = {};
  let depth = 0;
  let current = '';
  const flush = () => {
    const colon = current.indexOf(':');
    if (colon > 0) {
      const property = current.slice(0, colon).trim();
      const value = current.slice(colon + 1).trim();
      if (property && value) declarations[property] = value;
    }
    current = '';
  };
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ';' && depth === 0) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return declarations;
}

// ---- colors ---------------------------------------------------------------

/** Resolves var() chains against the tokens a theme declared. */
function resolveValue(value, tokens, seen = new Set()) {
  let resolved = String(value).trim();
  for (let pass = 0; pass < 12 && resolved.includes('var('); pass += 1) {
    const start = resolved.indexOf('var(');
    const end = matchParen(resolved, start + 3);
    if (end < 0) break;
    const inner = resolved.slice(start + 4, end);
    const comma = splitTopLevel(inner);
    const name = comma[0].trim();
    const fallback = comma.slice(1).join(',').trim();
    if (seen.has(name)) return undefined;
    const next = tokens[name] !== undefined ? tokens[name] : fallback;
    if (next === undefined || next === '') return undefined;
    seen.add(name);
    resolved = resolved.slice(0, start) + next + resolved.slice(end + 1);
  }
  return resolved.includes('var(') ? undefined : resolved;
}

function matchParen(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

/** A color as {r,g,b,a}, or undefined when it is not a color this can read. */
function parseColor(value) {
  if (!value) return undefined;
  const text = String(value).trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = (part) => parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (part) =>
      part.endsWith('%') ? Math.round((parseFloat(part) / 100) * 255) : parseFloat(part);
    return {
      r: channel(parts[0]),
      g: channel(parts[1]),
      b: channel(parts[2]),
      a: parts[3] === undefined ? 1 : parseFloat(parts[3]),
    };
  }
  const mix = text.match(/^color-mix\(in srgb,([\s\S]+)\)$/);
  if (mix) {
    const [first, second] = splitTopLevel(mix[1]).map((part) => part.trim());
    const read = (part) => {
      const percent = part.match(/(-?[\d.]+)%\s*$/);
      const color = parseColor(part.replace(/(-?[\d.]+)%\s*$/, '').trim());
      return { color, weight: percent ? parseFloat(percent[1]) / 100 : undefined };
    };
    const left = read(first);
    const right = read(second);
    if (!left.color || !right.color) return undefined;
    const leftWeight = left.weight ?? (right.weight === undefined ? 0.5 : 1 - right.weight);
    const rightWeight = right.weight ?? 1 - leftWeight;
    const total = leftWeight + rightWeight || 1;
    return {
      r: (left.color.r * leftWeight + right.color.r * rightWeight) / total,
      g: (left.color.g * leftWeight + right.color.g * rightWeight) / total,
      b: (left.color.b * leftWeight + right.color.b * rightWeight) / total,
      a: (left.color.a * leftWeight + right.color.a * rightWeight) / total,
    };
  }
  return undefined;
}

/** Lays a color over what is behind it. */
function composite(color, behind) {
  if (!color) return behind;
  if (color.a >= 1) return color;
  if (!behind) return undefined;
  const alpha = color.a;
  return {
    r: color.r * alpha + behind.r * (1 - alpha),
    g: color.g * alpha + behind.g * (1 - alpha),
    b: color.b * alpha + behind.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const brighter = Math.max(light, dark);
  const darker = Math.min(light, dark);
  return (brighter + 0.05) / (darker + 0.05);
}

// ---- the model ------------------------------------------------------------

/** Whether a rule rules itself out of a state, as `:not(:hover)` does. */
function excludesState(selector, state) {
  const excluded = [...selector.matchAll(/:not\(([^)]*)\)/g)].map((match) => match[1]);
  if (state === 'hover') return excluded.some((part) => part.includes(':hover'));
  if (state === 'focus') return excluded.some((part) => part.includes(':focus'));
  if (state === 'active') return excluded.some((part) => part.includes('.active'));
  return false;
}

/** Which state a selector describes. */
function stateOf(selector) {
  if (/:hover/.test(selector)) return 'hover';
  if (/:focus-visible|:focus\b/.test(selector)) return 'focus';
  if (/\.active|\[aria-selected="true"\]|\[aria-pressed="true"\]|\.is-open|\[open\]/.test(selector)) {
    return 'active';
  }
  return 'base';
}

/** The compound a selector ends with, without its state, such as `button`. */
function elementKey(selector) {
  const compounds = selector
    .replace(/\s*>\s*|\s*\+\s*|\s*~\s*/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const last = compounds[compounds.length - 1] ?? '';
  const stripped = last
    .replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\.active|\.is-open/g, '');
  return stripped || last;
}

/** The compounds a selector sits inside, nearest first. */
function ancestorKeys(selector) {
  const compounds = selector
    .replace(/\s*>\s*|\s*\+\s*|\s*~\s*/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, -1)
    .map((compound) =>
      compound
        .replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\.active|\.is-open/g, ''),
    )
    .filter(Boolean);
  return compounds.reverse();
}

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:{1}[a-z-]+(\([^)]*\))?/g) || []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length;
  return ids * 100 + classes * 10 + elements;
}

/** A selector without its state marks, as a list of compounds. */
function compoundsOf(selector) {
  return selector
    .replace(/\s*>\s*|\s*\+\s*|\s*~\s*/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((compound) =>
      compound
        .replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\.active|\.is-open/g, ''),
    )
    .filter(Boolean);
}

/** The simple parts of one compound, such as `button.active` -> button, .active. */
function partsOf(compound) {
  return (compound.match(/^[a-z][\w-]*|\.[\w-]+|#[\w-]+/g) || []).filter(Boolean);
}

/**
 * Whether a rule written for `ruleCompounds` also styles the element that
 * `elementCompounds` describes: every compound of the rule must appear, in
 * order, among the element's ancestors, and its last compound must be part of
 * the element's own.
 */
function rests(ruleCompounds, elementCompounds) {
  if (!ruleCompounds.length || !elementCompounds.length) return false;
  const ruleLast = partsOf(ruleCompounds[ruleCompounds.length - 1]);
  const elementLast = partsOf(elementCompounds[elementCompounds.length - 1]);
  if (!ruleLast.length || !ruleLast.every((part) => elementLast.includes(part))) return false;
  let index = elementCompounds.length - 2;
  for (let position = ruleCompounds.length - 2; position >= 0; position -= 1) {
    const wanted = partsOf(ruleCompounds[position]);
    let found = false;
    while (index >= 0) {
      const candidate = partsOf(elementCompounds[index]);
      index -= 1;
      if (wanted.every((part) => candidate.includes(part))) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** A shorthand such as `background: var(--panel) url(...)` starts with its color. */
function firstColorToken(value) {
  const text = String(value).trim();
  const match = text.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|color-mix\([\s\S]*\)|transparent)/);
  return match ? match[1] : text;
}

/** Every rule that declares a color or a background, with its state. */
function buildDeclarations(rules, tokens) {
  const declared = [];
  rules.forEach((rule, order) => {
    rule.selectors.forEach((selector) => {
      if (selector.startsWith(':root') || selector === 'html') return;
      const declaredColor = rule.declarations.color;
      const color =
        declaredColor && /^(inherit|currentcolor|unset|initial)$/i.test(declaredColor.trim())
          ? undefined
          : resolveValue(declaredColor, tokens);
      const background =
        resolveValue(rule.declarations.background, tokens) ??
        resolveValue(rule.declarations['background-color'], tokens);
      if (!color && !background) return;
      declared.push({
        selector,
        compounds: compoundsOf(selector),
        state: stateOf(selector),
        order,
        rank: specificity(selector),
        color: color ? parseColor(firstColorToken(color)) : undefined,
        background: background ? parseColor(firstColorToken(background)) : undefined,
      });
    });
  });
  return declared;
}

/** The declaration that wins for an element in a state. */
function resolveFor(declared, compounds, state, property) {
  const matches = declared.filter(
    (entry) =>
      entry[property] &&
      (entry.state === state || entry.state === 'base') &&
      !excludesState(entry.selector, state) &&
      rests(entry.compounds, compounds),
  );
  if (!matches.length) return undefined;
  return matches
    .sort(
      (left, right) =>
        (left.state === state ? 1 : 0) - (right.state === state ? 1 : 0) ||
        left.rank - right.rank ||
        left.order - right.order,
    )
    .pop();
}

/**
 * What an element's text sits on: its own background in that state, then the
 * backgrounds of the things it sits inside, then the page.
 */
function backgroundBehind(declared, compounds, state, pageBackground) {
  const layers = [];
  for (let depth = compounds.length; depth > 0; depth -= 1) {
    layers.push(resolveFor(declared, compounds.slice(0, depth), state, 'background'));
  }
  let behind = pageBackground;
  let from;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!layer?.background) continue;
    behind = composite(layer.background, behind);
    if (layer.background.a > 0) from = layer.selector;
  }
  return { color: behind, from };
}

function isDecorative(selector, key) {
  return DECORATIVE.some((mark) => selector.includes(mark) || key === mark);
}

/** Every readability problem a page has in a theme. */
function findProblems(html, { pageBackgroundToken = '--bg' } = {}, palette) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');
  const rules = parseRules(css);
  const tokens = { ...palette };
  rules.forEach((rule) => {
    if (!rule.selectors.some((selector) => selector.includes(':root'))) return;
    Object.entries(rule.declarations).forEach(([property, value]) => {
      if (property.startsWith('--')) tokens[property] = value;
    });
  });
  const pageBackground =
    parseColor(resolveValue(`var(${pageBackgroundToken})`, tokens)) ?? { r: 0, g: 0, b: 0, a: 1 };
  const declared = buildDeclarations(rules, tokens);
  const problems = [];
  const checked = new Set();

  for (const entry of declared) {
    // An element that declares only a background is checked too: its text
    // comes from a broader rule, and moving the ground under inherited text
    // is exactly how a field ends up black on black.
    if (!entry.color && !entry.background) continue;
    // Each element that declares a color is checked in every state something
    // gives it, since a hover elsewhere may move the ground under it.
    for (const state of ['base', 'hover', 'focus', 'active']) {
      // A selector and the same selector with its state pseudo describe one
      // element, so they are one finding.
      const key = `${entry.compounds.join(' ')}|${state}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const colorRule = resolveFor(declared, entry.compounds, state, 'color');
      if (!colorRule?.color) continue;
      const { color: background, from } = backgroundBehind(
        declared,
        entry.compounds,
        state,
        pageBackground,
      );
      // Only a background something actually declares is judged. Falling back
      // to the page would guess at what an element sits on, and guessing is
      // how a check like this ends up crying wolf.
      if (!background || !from) continue;
      const foreground = composite(colorRule.color, background);
      if (!foreground || foreground.a === 0) continue;
      const ratio = contrastRatio(foreground, background);
      const last = entry.compounds[entry.compounds.length - 1] ?? '';
      const required = LARGE_TEXT_KEYS.has(last) ? LARGE_TEXT_RATIO : TEXT_RATIO;
      if (ratio >= required) continue;
      if (isDecorative(colorRule.selector, last)) continue;
      problems.push({
        key: entry.compounds.join(' '),
        state,
        ratio: Math.round(ratio * 100) / 100,
        required,
        colorFrom: colorRule.selector,
        backgroundFrom: from ?? `page ${pageBackgroundToken}`,
      });
    }
  }
  return problems;
}

// ---- the check ------------------------------------------------------------

const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const BASELINE = path.join(__dirname, 'contrast-baseline.json');

/** Every problem in every theme, as [signature, problem] pairs. */
function collect() {
  const found = new Map();
  for (const theme of themes) {
    // A theme that follows VS Code is checked against both a light and a dark
    // VS Code theme, since it takes its colors from whichever is set.
    const palettes =
      theme === 'corpo'
        ? [
            ['VS Code dark', VSCODE_PALETTES.dark],
            ['VS Code light', VSCODE_PALETTES.light],
          ]
        : [['', {}]];
    for (const [paletteName, palette] of palettes) {
      for (const [page, html] of renderPagesForTheme(theme)) {
        for (const problem of findProblems(html, {}, palette)) {
          const where = paletteName ? `${theme} (${paletteName})` : theme;
          const signature = `${where} · ${problem.key} · ${problem.state}`;
          if (found.has(signature)) continue;
          found.set(signature, { ...problem, page, where });
        }
      }
    }
  }
  return found;
}

function describe(signature, problem) {
  return (
    `  ${signature}: ${problem.ratio}:1, needs ${problem.required}:1  (${problem.page})\n` +
    `      color from ${problem.colorFrom}\n` +
    `      on background from ${problem.backgroundFrom}`
  );
}

function run() {
  const found = collect();
  const updating = process.argv.includes('--update');
  if (updating) {
    const baseline = [...found.keys()].sort();
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`recorded ${baseline.length} known contrast problems`);
    return;
  }

  let baseline = [];
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    baseline = [];
  }
  const known = new Set(baseline);
  const introduced = [...found].filter(([signature]) => !known.has(signature));
  const fixed = baseline.filter((signature) => !found.has(signature));

  if (introduced.length) {
    console.error('New contrast problems:\n');
    introduced.forEach(([signature, problem]) => console.error(describe(signature, problem)));
    console.error(
      `\n${introduced.length} new contrast problem${introduced.length === 1 ? '' : 's'}.` +
        '\nFix them, or record them with "npm run test:contrast -- --update" when they are deliberate.',
    );
    process.exit(1);
  }

  if (fixed.length) {
    console.log(`${fixed.length} known contrast problem${fixed.length === 1 ? '' : 's'} fixed.`);
    console.log('Record it with "npm run test:contrast -- --update".');
  }
  const remaining = found.size;
  console.log(
    remaining
      ? `no new contrast problems; ${remaining} known ${remaining === 1 ? 'one remains' : 'ones remain'}`
      : 'every theme reads at AA, at rest and on hover, focus, and active',
  );
}

if (require.main === module) {
  run();
}

module.exports = { findProblems, contrastRatio, parseColor, parseRules, collect };
