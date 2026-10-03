// Makes a webview page self-contained, the way every harness expects it.
//
// VS Code loads a page's scripts and style sheets by URI, through
// asWebviewUri, and the refactor moves the pages to bundles loaded that way
// (docs/architecture/decisions/0001-load-page-bundles-through-aswebviewuri.md).
// The harnesses cannot fetch those URIs: jsdom runs only inline scripts,
// Chrome opens the page as an iframe's srcdoc, and the text checks read one
// string. So each harness passes the page through here first, which reads
// every <script src> and <link rel="stylesheet"> that names a file of the
// extension and inlines it with the page's nonce, marking each script and
// sheet it inlined with data-inlined-from. A page that is already
// self-contained comes back unchanged.
//
// An inlined sheet must load as the linked one would, so two things follow
// it. A url() in it names a file relative to the sheet, so it is rewritten
// against the sheet's URI, as the browser would resolve it. And a page's
// policy admits a linked sheet by its origin (style-src names the
// extension's), which says nothing of an inline copy; Chrome enforces the
// policy in the layout harness, so the loader adds the page's nonce to
// style-src, and gives it to each sheet the policy admitted. A sheet from an
// origin the policy does not name is inlined without it, and Chrome blocks
// it, as VS Code would block the link.
const path = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');

/**
 * The URI prefixes a harness's stand-in webview hands out, and VS Code's own,
 * each followed by a path that names a file of the extension.
 */
const WEBVIEW_ORIGINS = [
  // The stand-in webview of test/ui/pages.js and the e2e stub: the path after
  // the origin is relative to the extension's root.
  { prefix: 'vscode-webview://deckard/', relative: true },
  // What asWebviewUri returns inside VS Code: an absolute file path.
  { prefix: 'https://file+.vscode-resource.vscode-cdn.net/', relative: false },
];

/** An element's attributes, from the text between its name and `>`. */
function readAttributes(text) {
  const attributes = new Map();
  for (const match of text.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Attributes as element text, leaving out the ones named. */
function writeAttributes(attributes, leaveOut) {
  return [...attributes]
    .filter(([name]) => !leaveOut.includes(name))
    .map(([name, value]) => ` ${name}="${value.replace(/"/g, '&quot;')}"`)
    .join('');
}

/**
 * The file a page asset's URI names, or undefined when it names something
 * outside the extension.
 *
 * @param {string} uri The `src` or `href` as the page has it.
 * @param {string} root The extension's root folder.
 */
function resolveAsset(uri, root) {
  const decoded = decodeURI(uri.split(/[?#]/)[0]);
  for (const origin of WEBVIEW_ORIGINS) {
    if (decoded.startsWith(origin.prefix)) {
      const rest = decoded.slice(origin.prefix.length);
      return origin.relative ? path.join(root, rest) : path.join('/', rest);
    }
  }
  if (decoded.startsWith('file://')) {
    return decoded.slice('file://'.length);
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !decoded.startsWith('//')) {
    return path.join(root, decoded);
  }
  return undefined;
}

/** Reads an asset, failing with the URI it came from when it is not there. */
function readAsset(uri, root, kind) {
  const file = resolveAsset(uri, root);
  if (!file) {
    throw new Error(`The page loads a ${kind} from outside the extension, which no harness can fetch: ${uri}`);
  }
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`The page loads a ${kind} that is not built: ${uri} (${file}). Run the build first.`, { cause: error });
  }
}

/** The page's Content-Security-Policy meta element, matched, or null. */
const POLICY = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;

/** The nonce the loader gives inlined sheets on a page whose policy names none. */
const LOADER_NONCE = 'deckardPageLoader';

/** The nonce the page's Content-Security-Policy names, if any. */
function readPageNonce(html) {
  const policy = POLICY.exec(html);
  return policy && /'nonce-([^']+)'/.exec(policy[2])?.[1];
}

/**
 * Whether a policy admits a style sheet from `uri`: there is no policy, or
 * its style-src (or default-src, without one) names a source the URI is
 * under. A `*` in a source stands for one part of a host name.
 *
 * @param {string | undefined} policy The policy's text.
 * @param {string} uri The sheet's URI as the page links it.
 */
function admitsSheet(policy, uri) {
  if (policy === undefined) {
    return true;
  }
  const directives = new Map(policy.split(';').map((part) => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
  const sources = directives.get('style-src') ?? directives.get('default-src') ?? [];
  return sources
    .filter((source) => !source.startsWith("'"))
    .some((source) => new RegExp(`^${source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/.]+')}(/|$)`).test(uri));
}

/**
 * The policy with `'nonce-<nonce>'` among its style-src sources, where it
 * was not already.
 */
function addStyleNonce(policy, nonce) {
  const source = `'nonce-${nonce}'`;
  const parts = policy.split(';').map((part) => part.trim()).filter(Boolean);
  const at = parts.findIndex((part) => /^style-src\b/.test(part));
  if (at < 0) {
    parts.push(`style-src ${source}`);
  } else if (!parts[at].split(/\s+/).includes(source)) {
    parts[at] = `${parts[at]} ${source}`;
  }
  return `${parts.join('; ')};`;
}

/**
 * A sheet's text with each relative url() resolved against the sheet's URI,
 * as the browser resolves it when the sheet is linked.
 *
 * @param {string} sheet The sheet's text.
 * @param {string} base The sheet's URI.
 */
function resolveSheetUrls(sheet, base) {
  return sheet.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _quote, target) => {
    if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) {
      return whole;
    }
    return `url("${new URL(target, base).href}")`;
  });
}

/**
 * Returns the page with every script and style sheet it loads from the
 * extension inlined, each carrying the page's nonce.
 *
 * @param {string} html The page as its host builds it.
 * @param {{ root?: string }} [options] `root` is the folder a stand-in
 *   webview URI's path is relative to; the repository by default.
 * @returns {string} A page no harness needs to fetch anything for.
 */
function loadPage(html, options = {}) {
  const root = options.root ?? ROOT;
  const pageNonce = readPageNonce(html);
  const withScripts = html.replace(/<script\b([^>]*)>\s*<\/script\b[^>]*>/gi, (whole, attributeText) => {
    const attributes = readAttributes(attributeText);
    if (!attributes.has('src')) {
      return whole;
    }
    const source = readAsset(attributes.get('src'), root, 'script');
    if (/<\/script/i.test(source)) {
      throw new Error(`${attributes.get('src')} contains "</script", so it cannot be inlined.`);
    }
    const nonce = attributes.get('nonce') ?? pageNonce;
    const from = ` data-inlined-from="${attributes.get('src').replace(/"/g, '&quot;')}"`;
    return `<script${nonce ? ` nonce="${nonce}"` : ''}${writeAttributes(attributes, ['src', 'nonce'])}${from}>${source}</script>`;
  });
  const policy = POLICY.exec(withScripts)?.[2];
  const sheetNonce = pageNonce ?? LOADER_NONCE;
  let admitted = false;
  const withSheets = withScripts.replace(/<link\b([^>]*)>/gi, (whole, attributeText) => {
    const attributes = readAttributes(attributeText);
    if ((attributes.get('rel') ?? '').toLowerCase() !== 'stylesheet' || !attributes.has('href')) {
      return whole;
    }
    const href = attributes.get('href');
    const sheet = resolveSheetUrls(readAsset(href, root, 'style sheet'), href);
    if (/<\/style/i.test(sheet)) {
      throw new Error(`${href} contains "</style", so it cannot be inlined.`);
    }
    const nonce = admitsSheet(policy, href) ? sheetNonce : undefined;
    admitted ||= nonce !== undefined;
    const from = ` data-inlined-from="${href.replace(/"/g, '&quot;')}"`;
    return `<style${nonce ? ` nonce="${nonce}"` : ''}${from}>${sheet}</style>`;
  });
  return admitted && policy !== undefined
    ? withSheets.replace(POLICY, (whole, open, text, close) => `${open}${addStyleNonce(text, sheetNonce)}${close}`)
    : withSheets;
}

module.exports = { loadPage, resolveAsset, readPageNonce };
