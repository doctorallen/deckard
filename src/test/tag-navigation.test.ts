import * as assert from 'assert';

import { resolveIndexedTagKey } from '../domain/index/tagNavigation';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { getEntityNamespaceAliases, parseMarkdown } from '../domain/markdown/parser';
import { createQueryContext } from '../domain/query/queryContext';
import { parseQuery } from '../domain/query/queryParser';
import { createDashboardSavedFilters } from '../ui/state/dashboardState';
import { createQueryViewState } from '../ui/state/querySuggestions';
import { evaluateSearchPage, resolveQueryTagIntersection } from '../ui/state/searchPageState';
import { buildQuickFindResults } from '../ui/state/quickFindState';
import { createPreferences } from './preferenceServices';

class MemoryStore {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

suite('Tag navigation', () => {
  test('resolves canonical and markerless namespaced keys', () => {
    const tags = new Map([
      ['#project/neon-relay', true],
      ['#topic/operations', true],
    ]);

    assert.strictEqual(
      resolveIndexedTagKey(tags, '#project/neon-relay'),
      '#project/neon-relay',
    );
    assert.strictEqual(
      resolveIndexedTagKey(tags, 'project/neon-relay'),
      '#project/neon-relay',
    );
    assert.strictEqual(
      resolveIndexedTagKey(tags, '#PROJECT/NEON-RELAY'),
      '#project/neon-relay',
    );
  });

  test('returns undefined for empty or unknown keys', () => {
    const tags = new Map([['#project/neon-relay', true]]);

    assert.strictEqual(resolveIndexedTagKey(tags, '  '), undefined);
    assert.strictEqual(resolveIndexedTagKey(tags, 'project/missing'), undefined);
  });

  test('resolves a namespace through its alias, as the index keyed the tag', () => {
    const tags = new Map([
      ['#org/acme', true],
      ['#client/zeta', true],
    ]);

    assert.strictEqual(resolveIndexedTagKey(tags, '#organization/acme'), '#org/acme');
    assert.strictEqual(resolveIndexedTagKey(tags, 'Organization/Acme'), '#org/acme');
    const aliases = getEntityNamespaceAliases({ customer: 'client' });
    assert.strictEqual(resolveIndexedTagKey(tags, '#customer/zeta', aliases), '#client/zeta');
    assert.strictEqual(resolveIndexedTagKey(tags, '#customer/zeta'), undefined, 'a workspace alias needs the workspace\'s aliases');
    assert.strictEqual(resolveIndexedTagKey(tags, '#org/acme', getEntityNamespaceAliases({ org: 'company' })), '#org/acme', 'a key the index has is taken as it is');
  });

  test('a search for a tag by its alias gets the tag\'s header on the search page', () => {
    const note = parseMarkdown('notes/acme.md', '# Acme #organization/acme\n');
    const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
    assert.deepStrictEqual(resolveQueryTagIntersection(index, parseQuery('#organization/acme')), ['#org/acme']);
  });

  test("the search page, its chips, and Home's saved views read a tag through the workspace's own aliases", () => {
    // A workspace that maps proj to project: the index keys #proj/atlas as
    // #project/atlas, and a search written the way the note wrote it is
    // read through the same aliases, from the search's context.
    const entityNamespaceAliases = getEntityNamespaceAliases({ proj: 'project' });
    const note = parseMarkdown('notes/atlas.md', '# Atlas #proj/atlas\n', undefined, { entityNamespaceAliases });
    const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
    const queryContext = createQueryContext(Date.now(), { entityNamespaceAliases });
    const parsed = parseQuery('#proj/atlas');

    assert.strictEqual(
      evaluateSearchPage(index, '#proj/atlas', { queryContext }).focusTag?.key,
      '#project/atlas',
      'the page has the tag\'s header',
    );
    assert.deepStrictEqual(
      createQueryViewState({ index, parsed, matchCounts: { notes: 1, tasks: 0 }, isAdvanced: true, recentQueries: [], queryContext }).tags,
      [{ key: '#project/atlas', label: '#proj/atlas' }],
      'the box shows the tag\'s chip',
    );
    const empty = createPreferences(new MemoryStore()).reader.value;
    const preferences = {
      ...empty,
      savedFilters: [{ id: 'atlas', name: 'Atlas', tagKeys: [], query: '#proj/atlas' }],
    };
    assert.deepStrictEqual(
      createDashboardSavedFilters(index, preferences, entityNamespaceAliases)[0].tags,
      [{ key: '#project/atlas', label: '#proj/atlas' }],
      'a saved view names the tag',
    );
    const found = buildQuickFindResults({
      index,
      preferences: empty,
      input: '#proj/atlas',
      searchText: () => ({ matches: [], partial: false }),
      queryContext,
    });
    assert.deepStrictEqual(
      found.notes.map((row) => row.filePath),
      ['notes/atlas.md'],
      'Find narrows to the tag, which is whole, not still being typed',
    );
  });
});
