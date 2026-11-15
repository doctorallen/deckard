import * as assert from 'assert';

import { narrowHelpPicked, PageRegistry, type PagePick } from '../ui/webview/host/pageRegistry';

suite('Open pages, as Help and the Tour reach them', () => {
  test('a spotlight goes to every visible page, or the visible pages of one name, and a page that closed hears nothing', () => {
    const registry = new PageRegistry();
    const heard: string[] = [];
    const page = (name: string, visible: boolean) => ({ name, visible: () => visible, post: () => void heard.push(name) });
    registry.add(page('Task board', true));
    registry.add(page('Home', false));
    const closing = registry.add(page('search page', true));
    assert.strictEqual(registry.broadcast({ type: 'spotlight', text: 'Hull inspection' }), 2);
    assert.deepStrictEqual(heard, ['Task board', 'search page']);
    closing.dispose();
    heard.length = 0;
    assert.strictEqual(registry.broadcast({ type: 'explore', on: true }, 'Task board'), 1);
    assert.deepStrictEqual(heard, ['Task board']);
    assert.deepStrictEqual(registry.openPages(), ['Task board', 'Home']);
  });

  test('what a page picked reaches whoever listens, and a pick is narrowed first', () => {
    const registry = new PageRegistry();
    const picks: PagePick[] = [];
    const listening = registry.onPicked((pick) => picks.push(pick));
    registry.picked({ page: 'Task board', id: 'lanes' });
    listening.dispose();
    registry.picked({ page: 'Task board', id: 'sort' });
    assert.deepStrictEqual(picks, [{ page: 'Task board', id: 'lanes' }]);
    assert.deepStrictEqual(narrowHelpPicked({ type: 'helpPicked', id: 'column-add' }), { type: 'helpPicked', id: 'column-add' });
    assert.deepStrictEqual(narrowHelpPicked({ type: 'helpPicked' }), { type: 'helpPicked' }, 'none: explore mode ended');
    assert.strictEqual(narrowHelpPicked({ type: 'helpPicked', id: '"><script>' }), undefined);
    assert.strictEqual(narrowHelpPicked({ type: 'openHelp' }), undefined);
  });
});
