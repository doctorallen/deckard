import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

/**
 * Tokenizes Markdown the way VS Code does, with Deckard's injection grammar,
 * to prove what it colors and, as much, what it leaves alone.
 *
 * VS Code ships vscode-textmate and vscode-oniguruma inside its own
 * node_modules.asar, so the test reads them from the running VS Code rather
 * than adding them as dependencies.
 */

interface Token {
  startIndex: number;
  endIndex: number;
  scopes: string[];
}

interface Grammar {
  tokenizeLine(line: string, state: unknown): { tokens: Token[]; ruleStack: unknown };
}

/** A file inside an asar archive, read with or without Electron's help. */
function readAsar(archive: string, inner: string): Buffer {
  try {
    return fs.readFileSync(path.join(archive, ...inner.split('/')));
  } catch {
    // Plain Node, or an Electron with asar reading turned off: parse it.
  }
  let plain: typeof fs = fs;
  try {
    plain = (require as (id: string) => typeof fs)('original-fs');
  } catch {
    // Not Electron; fs is the plain one.
  }
  const handle = plain.openSync(archive, 'r');
  try {
    const head = Buffer.alloc(16);
    plain.readSync(handle, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const json = Buffer.alloc(head.readUInt32LE(12));
    plain.readSync(handle, json, 0, json.length, 16);
    let entry = JSON.parse(json.toString('utf8')) as {
      files?: Record<string, unknown>;
      offset?: string;
      size?: number;
      unpacked?: boolean;
    };
    for (const part of inner.split('/')) {
      entry = entry.files?.[part] as typeof entry;
    }
    if (entry.unpacked) {
      return plain.readFileSync(path.join(`${archive}.unpacked`, ...inner.split('/')));
    }
    const out = Buffer.alloc(entry.size ?? 0);
    plain.readSync(handle, out, 0, out.length, 8 + headerSize + Number(entry.offset));
    return out;
  } finally {
    plain.closeSync(handle);
  }
}

/** Runs a CommonJS bundle's source and gives back its exports. */
function loadModule<T>(source: string): T {
  const module = { exports: {} as T };
  new Function('module', 'exports', 'require', source)(module, module.exports, require);
  return module.exports;
}

let grammar: Grammar;
let initial: unknown;

async function loadMarkdownGrammar(): Promise<void> {
  const app = vscode.env.appRoot;
  const archive = path.join(app, 'node_modules.asar');
  const textmate = loadModule<{
    Registry: new (options: unknown) => { loadGrammar(scope: string): Promise<Grammar> };
    INITIAL: unknown;
  }>(readAsar(archive, 'vscode-textmate/release/main.js').toString('utf8'));
  const oniguruma = loadModule<{
    loadWASM(data: ArrayBuffer): Promise<void>;
    OnigScanner: new (patterns: string[]) => unknown;
    OnigString: new (text: string) => unknown;
  }>(readAsar(archive, 'vscode-oniguruma/release/main.js').toString('utf8'));
  const wasm = readAsar(archive, 'vscode-oniguruma/release/onig.wasm');
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);

  const read = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));
  const extensions = path.join(app, 'extensions');
  const yaml: Record<string, string> = {
    'source.yaml': 'yaml.tmLanguage.json',
    'source.yaml.1.3': 'yaml-1.3.tmLanguage.json',
    'source.yaml.1.2': 'yaml-1.2.tmLanguage.json',
    'source.yaml.1.1': 'yaml-1.1.tmLanguage.json',
    'source.yaml.1.0': 'yaml-1.0.tmLanguage.json',
    'source.yaml.embedded': 'yaml-embedded.tmLanguage.json',
  };
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text: string) => new oniguruma.OnigString(text),
    }),
    loadGrammar: (scope: string) => {
      if (scope === 'text.html.markdown') {
        return Promise.resolve(read(path.join(extensions, 'markdown-basics', 'syntaxes', 'markdown.tmLanguage.json')));
      }
      if (scope === 'markdown.deckard.injection') {
        return Promise.resolve(
          read(path.resolve(__dirname, '..', '..', 'syntaxes', 'deckard.injection.tmLanguage.json')),
        );
      }
      if (yaml[scope] && fs.existsSync(path.join(extensions, 'yaml', 'syntaxes', yaml[scope]))) {
        return Promise.resolve(read(path.join(extensions, 'yaml', 'syntaxes', yaml[scope])));
      }
      return Promise.resolve(null);
    },
    getInjections: (scope: string) => (scope === 'text.html.markdown' ? ['markdown.deckard.injection'] : []),
  });
  grammar = await registry.loadGrammar('text.html.markdown');
  initial = textmate.INITIAL;
}

/** Each piece of text Deckard's grammar scoped, with its Deckard scopes. */
function scoped(text: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  let state = initial;
  for (const line of text.split('\n')) {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    for (const token of result.tokens) {
      const scopes = token.scopes.filter((scope) => scope.endsWith('.deckard'));
      if (scopes.length > 0) {
        found.push([line.slice(token.startIndex, token.endIndex), scopes.at(-1)!]);
      }
    }
  }
  return found;
}

suite('Markdown injection grammar', () => {
  suiteSetup(async function () {
    this.timeout(30000);
    await loadMarkdownGrammar();
  });

  test('the manifest injects it into Markdown', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { contributes: { grammars: Array<{ scopeName: string; path: string; injectTo: string[] }> } };
    assert.deepStrictEqual(manifest.contributes.grammars, [
      {
        scopeName: 'markdown.deckard.injection',
        path: './syntaxes/deckard.injection.tmLanguage.json',
        injectTo: ['text.html.markdown'],
      },
    ]);
  });

  test('scopes a link, its heading, and its alias', () => {
    assert.deepStrictEqual(scoped('See [[Atlas#Decision|the decision]].'), [
      ['[[', 'punctuation.definition.link.begin.deckard'],
      ['Atlas#Decision', 'string.other.link.title.markdown.deckard'],
      ['|', 'punctuation.separator.alias.deckard'],
      ['the decision', 'string.other.link.description.markdown.deckard'],
      [']]', 'punctuation.definition.link.end.deckard'],
    ]);
  });

  test('marks an embed, and a link in a heading', () => {
    assert.deepStrictEqual(scoped('![[Atlas]]')[0], ['!', 'punctuation.definition.link.embed.deckard']);
    assert.deepStrictEqual(scoped('## Plan [[Atlas]]')[1], ['Atlas', 'string.other.link.title.markdown.deckard']);
  });

  test('scopes a status character, and leaves a plain box, a done one, and a migrated one alone', () => {
    assert.deepStrictEqual(scoped('- [/] Draft the plan'), [
      ['[', 'punctuation.definition.task-status.begin.deckard'],
      ['/', 'keyword.other.task-status.deckard'],
      [']', 'punctuation.definition.task-status.end.deckard'],
    ]);
    assert.deepStrictEqual(scoped('- [-] Order the banner')[1], ['-', 'keyword.other.task-status.deckard']);
    assert.deepStrictEqual(scoped('- [ ] Plain\n- [x] Done\n- [>] Moved\n- [a](https://example.com)'), []);
  });

  test('scopes task dates, repeat rules, priority, and a block id', () => {
    assert.deepStrictEqual(
      scoped('- [ ] Ship 📅 2026-10-02 ⏳ 2026-09-30 🔁 every week when done ⏫ ^abc'),
      [
        ['2026-10-02', 'constant.numeric.date.due.deckard'],
        ['2026-09-30', 'constant.numeric.date.scheduled.deckard'],
        ['every week when done', 'string.other.repeat.deckard'],
        ['⏫', 'keyword.other.priority.deckard'],
        ['^abc', 'variable.other.block-id.deckard'],
      ],
    );
    const dataview = scoped('- [ ] Ship [due:: 2026-10-02] [repeat:: every month] (priority:: high)');
    assert.ok(dataview.some(([text, scope]) => text === 'due' && scope === 'entity.other.attribute-name.deckard'));
    assert.ok(dataview.some(([text, scope]) => text === '2026-10-02' && scope === 'constant.numeric.date.due.deckard'));
    assert.ok(dataview.some(([text, scope]) => text === 'every month' && scope === 'string.other.repeat.deckard'));
    assert.ok(dataview.some(([text, scope]) => text === 'high' && scope === 'constant.language.priority.deckard'));
  });

  test('leaves code, front matter, and tags alone', () => {
    assert.deepStrictEqual(scoped('Code `[[Atlas]] 📅 2026-10-02` here'), []);
    assert.deepStrictEqual(scoped('```\n[[Atlas]] 📅 2026-10-02\n```'), []);
    assert.deepStrictEqual(scoped('---\ntitle: [[Atlas]] 📅 2026-10-02\n---\n'), []);
    assert.deepStrictEqual(scoped('A line about #project/atlas'), []);
  });
});
