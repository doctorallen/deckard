import * as assert from 'assert';

import type { QueryFacet } from '../domain/model/query';
import type { RankedNote, SidebarNotesSnapshot, SidebarTag } from '../ui/protocol/sidebarNotes';
import type { SearchRefineState } from '../ui/protocol/shared';
import { normalizeBody } from '../../test/harness/domSnapshot';
import { renderPage } from './pages';
import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * Related Notes' Refine and its weight rails (src/webview/sidebarNotes:
 * refine.tsx and weights.tsx) against the sidebar's template script, which
 * still draws the page: Refine for every kind of facet and value, folded and
 * unfolded; each of the note's own tags with its weight and what a search
 * for it finds; and each result's relevance, with its breakdown and the
 * reasons its card gives. Each is the DOM the template drew, as test:dom
 * normalizes both.
 */

type Shared = Record<string, (...args: unknown[]) => unknown>;

/** A query with the facets given, as a search page's Refine state carries it. */
function refineOf(text: string, facets: QueryFacet[], title = 'Project: Atlas'): SearchRefineState {
  return {
    page: 'search',
    title,
    resultKinds: ['notes', 'tasks'],
    query: {
      text,
      terms: [],
      canAppend: true,
      isAdvanced: false,
      diagnostics: [],
      builder: { join: 'and', items: [] },
      tags: [],
      suggestions: { fields: [], values: {}, operators: {} as never, conditions: [], recent: [], aliases: {} },
      matchCounts: { notes: 8, tasks: 2 },
      facets,
    },
  };
}

/** How a tag value is related: by its share of the results, by strength alone, or not at all. */
function relation(index: number): { strength?: number; total?: number } {
  if (index < 3) {
    return { strength: index / 3, total: 8 };
  }
  return index < 6 ? { strength: index / 7 } : {};
}

/** Eight tag values, the first related by share of the results, then by strength, then by neither. */
const TAG_VALUES = Array.from({ length: 8 }, (_, index) => ({
  label: index % 2 ? `#topic/t${index}` : `@person-${index}`,
  count: 8 - index,
  clause: index % 2 ? `#topic/t${index}` : `@person-${index}`,
  ...relation(index),
  ...(index === 1 ? { detail: 'Written together 4 times' } : {}),
}));

/** Every Refine the sidebar can show: no search, nothing to narrow by, and each kind of facet. */
const REFINES: Array<[string, SearchRefineState]> = [
  ['no search yet', refineOf('  ', [{ id: 'tags', label: 'Tags', applied: [], values: TAG_VALUES }])],
  ['nothing left to narrow by', refineOf('#project/atlas', [])],
  ['no title', refineOf('#project/atlas', [], '')],
  ['every kind of facet', refineOf('#project/atlas "a & <b>"', [
    { id: 'related', label: 'Related tags', applied: [], values: TAG_VALUES.slice(0, 3) },
    { id: 'tags', label: 'Tags', applied: ['#topic/t1'], values: TAG_VALUES },
    { id: 'status', label: 'Status', applied: [], values: [{ label: 'open', count: 3, clause: 'is:open' }, { label: 'done', count: 1, clause: 'is:done', detail: 'Finished' }] },
    { id: 'folder', label: 'Folder', applied: [], values: Array.from({ length: 6 }, (_, index) => ({ label: `folder ${index}`, count: index, clause: `in:"folder ${index}"` })) },
  ])],
];

/** The note's own tags: weighted and not, with and without what a search finds. */
const ACTIVE_TAGS: SidebarTag[] = [
  { key: '#project/atlas', label: '#project/atlas', weight: 1, matches: { notes: 2, tasks: 1 } },
  { key: '@dana', label: '@dana', weight: 0.5, matches: { notes: 1, tasks: 0 } },
  { key: '#topic/ops', label: '#topic/ops', weight: 0.3 },
  { key: '#area/home', label: '#area/home', weight: 0 },
  { key: '#odd', label: '#odd', weight: Number.NaN, matches: { notes: 0, tasks: 2 } },
  { key: '#a & <b>', label: '#a & <b>', weight: 0.75 },
];

/** A ranked result, with the evidence and reasons given. */
function rankedNote(line: number, values: Partial<RankedNote>): RankedNote {
  return {
    sectionId: `section-${line}`,
    filePath: `notes/n${line}.md`,
    title: `Note ${line}`,
    fileName: `n${line}.md`,
    sourceLine: line,
    headingPath: [],
    titleTags: [],
    matchedTags: [],
    matchCount: 1,
    totalTagCount: 1,
    overlap: 1,
    relevanceScore: 50,
    ...values,
  };
}

const ATLAS = { key: '#project/atlas', label: 'project/atlas' };
const OPS = { key: '#topic/ops', label: 'topic/ops' };

/** Results whose scores, evidence, and reasons reach each part of the breakdown. */
const NOTES: RankedNote[] = [
  rankedNote(1, { relevanceScore: 84 }),
  rankedNote(2, { relevanceScore: 40, associationWeight: 0.6, reasons: ['Shared: project/atlas', 'Linked note'], matchedTags: [ATLAS] }),
  rankedNote(3, { relevanceScore: 20, reasons: ['Shared: project/atlas'], matchedTags: [ATLAS], titleTags: [ATLAS] }),
  rankedNote(4, { relevanceScore: 0, reasons: ['Associated: project/atlas, topic/ops'], matchedTags: [ATLAS] }),
  rankedNote(5, {
    relevanceScore: 75,
    reasons: ['Shares #project/atlas', 'Similar wording: "a & <b>"'],
    relevanceEvidence: {
      directTagWeight: 1.5, associationWeight: 0.4, normalizedAssociationWeight: 0.4, appliedAssociationWeight: 0.4,
      entryLinkWeight: 0.25, fileLinkWeight: 0.125, lexicalWeight: 0.2, recencyWeight: 0.01, specificityPenalty: 0.236,
      lexicalTerms: [{ term: 'route', contribution: 1 }],
    },
  }),
  rankedNote(6, { relevanceScore: 37.5, reasons: ['Shared: topic/ops'], matchedTags: [OPS], titleTags: [ATLAS] }),
];

suite('Related Notes\' Refine and weight rails draw what its template drew', () => {
  let core: WebviewPage;
  let legacy: WebviewPage | undefined;
  suiteSetup(() => {
    const bundle = bundleShared(['../sidebarNotes/refine', '../sidebarNotes/weights']);
    core = openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${bundle}</script></body></html>`);
  });
  suiteTeardown(() => core.dispose());
  teardown(() => {
    legacy?.dispose();
    legacy = undefined;
  });

  const shared = (): Shared => (core.window as unknown as { shared: Shared }).shared;

  /** The template page, drawing a snapshot. */
  const template = (snapshot: Partial<SidebarNotesSnapshot>): WebviewPage => {
    legacy?.dispose();
    legacy = openWebviewPage(renderPage('sidebarNotes'), { activeTags: [], notes: [], tagTitleDisplayMode: 'inline', state: 'ready', ...snapshot });
    return legacy;
  };

  /** Copies of elements the template drew, side by side in one element, normalized. */
  const drawnBefore = (elements: readonly Element[]): string => {
    const container = core.document.createElement('div');
    elements.forEach((element) => container.append(core.document.importNode(element, true)));
    container.normalize();
    return normalizeBody(container);
  };

  /** A component drawn on its own, normalized. */
  const drawnNow = (component: string, props: unknown): string => {
    const container = core.document.createElement('div');
    shared().render(shared().h(shared()[component], props), container);
    return normalizeBody(container);
  };

  test('Refine, for each kind of facet and value, folded and then unfolded', () => {
    for (const [what, refine] of REFINES) {
      const page = template({ state: 'refine', refine });
      assert.strictEqual(drawnNow('Refine', { refine, expanded: new Set() }), drawnBefore([...page.find('#app').children]), what);
      for (const more of page.findAll('.refine-more')) {
        const id = String(more.getAttribute('data-facet-id'));
        page.click(`.refine-more[data-facet-id="${id}"]`);
      }
      const opened = new Set(refine.query.facets.filter((facet) => facet.values.length > 5).map((facet) => facet.id));
      assert.strictEqual(drawnNow('Refine', { refine, expanded: opened }), drawnBefore([...page.find('#app').children]), `${what}, unfolded`);
    }
  });

  test('each of the note\'s own tags, with its weight and what a search for it finds', () => {
    const page = template({ activeFileName: 'today.md', activeTags: ACTIVE_TAGS });
    page.click('[data-action="show-every-active-tag"]');
    const before = page.findAll('.active-tag-open');
    assert.strictEqual(before.length, ACTIVE_TAGS.length);
    ACTIVE_TAGS.forEach((tag, index) => {
      assert.strictEqual(drawnNow('ActiveTag', { tag }), drawnBefore([before[index]]), tag.key);
    });
  });

  test('each result\'s relevance, with its breakdown and the reasons its card gives', () => {
    for (const mode of ['inline', 'separate'] as const) {
      const page = template({ notes: NOTES, tagTitleDisplayMode: mode });
      const cards = page.findAll('.note');
      assert.strictEqual(cards.length, NOTES.length);
      NOTES.forEach((note, index) => {
        // The tags drawn as chips on the card, as the card names them.
        const chips = mode === 'separate' && note.matchedTags.length ? note.matchedTags : note.titleTags;
        const reasons = shared().explainRelevance(note, chips.map((tag) => tag.label)) as string[];
        const what = `${mode}: ${note.title}`;
        assert.strictEqual(drawnNow('RelevanceScore', { note, reasons }), drawnBefore([cards[index].querySelector('.relevance-wrap') as Element]), what);
        assert.strictEqual(reasons[0], cards[index].querySelector('.relevance-reason')?.textContent ?? undefined, `${what}: the reason under the card`);
      });
    }
  });
});
