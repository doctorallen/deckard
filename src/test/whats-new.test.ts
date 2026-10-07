import * as assert from 'assert';

import * as vscode from 'vscode';

import { LAST_SEEN_VERSION, WHATS_NEW_PENDING, WhatsNew } from '../ui/commands/whatsNew';

/** A Memento that keeps its values in memory. */
function memento(initial: Record<string, unknown> = {}): vscode.Memento {
  const store = new Map(Object.entries(initial));
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

const CHANGELOG = [
  '## Unreleased',
  '',
  '## 1.24.0 - 2026-10-09',
  '',
  '### Highlights',
  '',
  '- Twenty-four.',
  '',
  '## 1.23.1 - 2026-10-05',
  '',
  '## 1.23.0 - 2026-10-02',
  '',
  '### Highlights',
  '',
  '- Twenty-three.',
  '',
  '## 1.22.0 - 2026-09-26',
].join('\n');

function whatsNew(
  version: string,
  state: vscode.Memento,
  options: { existingUser?: boolean; changelog?: string } = {},
): WhatsNew {
  return new WhatsNew({
    globalState: state,
    version,
    existingUser: options.existingUser ?? true,
    readChangelog: async () => options.changelog ?? CHANGELOG,
  });
}

suite("What's new", () => {
  test('a new install records its version and says nothing', async () => {
    const state = memento();
    const news = whatsNew('1.23.0', state, { existingUser: false });
    await news.onActivate();
    assert.strictEqual(state.get(LAST_SEEN_VERSION), '1.23.0');
    assert.strictEqual(news.pending(), undefined);
  });

  test('an existing user from before versions were kept hears of the update from 1.22', async () => {
    const state = memento({ 'deckard.preferences': {} });
    const news = whatsNew('1.23.0', state);
    await news.onActivate();
    assert.deepStrictEqual(news.pending(), { version: '1.23' });
    assert.strictEqual(news.newSince(), '1.22.0');
  });

  test('a patch update says nothing', async () => {
    const state = memento({ [LAST_SEEN_VERSION]: '1.23.0' });
    const news = whatsNew('1.23.1', state);
    await news.onActivate();
    assert.strictEqual(news.pending(), undefined);
    assert.strictEqual(state.get(LAST_SEEN_VERSION), '1.23.1');
  });

  test('two skipped feature releases keep the oldest version updated from', async () => {
    const state = memento({ [LAST_SEEN_VERSION]: '1.22.0' });
    await whatsNew('1.23.0', state).onActivate();
    const news = whatsNew('1.24.0', state);
    await news.onActivate();
    assert.deepStrictEqual(state.get(WHATS_NEW_PENDING), { from: '1.22.0', to: '1.24.0' });
    assert.deepStrictEqual(news.pending(), { version: '1.24' });
  });

  test('a feature update without Highlights says nothing', async () => {
    const state = memento({ [LAST_SEEN_VERSION]: '1.22.0' });
    const news = whatsNew('1.23.0', state, { changelog: '## 1.23.0 - 2026-10-02\n\n### Added\n\n- x\n' });
    await news.onActivate();
    assert.strictEqual(news.pending(), undefined);
  });

  test('clearing it takes the line away', async () => {
    const state = memento({ [LAST_SEEN_VERSION]: '1.22.0' });
    const news = whatsNew('1.23.0', state);
    await news.onActivate();
    let fired = 0;
    news.onDidChange(() => (fired += 1));
    await news.clear();
    assert.strictEqual(news.pending(), undefined);
    assert.strictEqual(fired, 1);
  });
});
