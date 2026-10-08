import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { QueryFacet, QueryViewState } from '../domain/model/query';
import { createQueryContext } from '../domain/query/queryContext';
import { parseQuery } from '../domain/query/queryParser';
import { normalizeBody } from '../../test/harness/domSnapshot';
import { bundleShared } from './sharedBundle';
import { templateRecords } from './templateRecords';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { createQueryViewState } from '../ui/state/querySuggestions';

/**
 * The shared search box (src/webview/shared/queryEditor.tsx) against the
 * template script it replaced (getQueryEditorScript, deleted in Phase 6
 * step 7): each state must be the DOM the template drew, as test:dom
 * normalizes it, and the same keys, clicks, and typing must draw the same,
 * run the same searches, and leave focus in the same place. The template's
 * side is its recording (templateRecords.ts), taken at each comparison as
 * the Task Board's template ran it, with a Save button and a Sorted label.
 * The bar has changed since, and asDrawnSinceTemplate says how.
 */

/** What the template drew, ran, was told, and focused, by test and step. */
const doneByTemplate = templateRecords('webview-query-editor');

/** The template's page at one step: `#app` normalized, what it ran and was told so far, and where focus was. */
interface StepRecord {
  readonly page: string;
  readonly ran: string[];
  readonly typed: string[];
  readonly focus: string;
}

const INDEX = buildWorkspaceIndex(new Map([
  ['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Call Ren #context/phone 📅 2026-09-21\n- [ ] Draft the plan #status/doing\n')],
  ['notes/beta.md', parseMarkdown('notes/beta.md', '# Beta #project/beta #topic/replicants\nThe lift is stuck.\n')],
]));
const QUERY_CONTEXT = createQueryContext(Date.parse('2026-09-21T12:00:00Z'));

const FACETS: QueryFacet[] = [
  {
    id: 'related',
    label: 'Related tags',
    applied: [],
    values: [
      { label: '#project/atlas', count: 3, clause: '#project/atlas', strength: 0.8, total: 4 },
      { label: '#context/phone', count: 1, clause: '#context/phone', strength: 0.2, detail: 'Written together 2 times' },
    ],
  },
  {
    id: 'status',
    label: 'Status',
    applied: ['is:open'],
    values: Array.from({ length: 7 }, (_, at) => ({ label: `state ${at}`, count: 7 - at, clause: `status = s${at}` })),
  },
];

/** The hammer Builder has carried since the template was recorded (HammerIcon in strokeIcons.tsx). */
const HAMMER = '<svg class="toolbar-icon query-builder-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 13.5 9.3 6.7"></path><path d="M9.1 1.9 14.1 6.9 11.9 9.1 6.9 4.1Z"></path></svg>';

/**
 * A recorded page as the bar has been drawn since the template was
 * recorded (plan 29, R1): no Search or Clear beside the field, which ends
 * in × (drawn only while Clear could act) and →; Builder joined to the
 * start of the field, pressed rather than renamed while open; the builder
 * under the field; the / key's part of the hint in a span of its own; and
 * the hint and the builder's paragraph marked .help-text (R9). Everything
 * else is held to the recording as it was.
 */
function asDrawnSinceTemplate(page: WebviewPage, recorded: string): string {
  const holder = page.document.createElement('div');
  holder.innerHTML = recorded;
  const make = (html: string): Element => {
    const made = page.document.createElement('div');
    made.innerHTML = html;
    return made.firstElementChild as Element;
  };
  for (const workspace of holder.querySelectorAll('.query-workspace')) {
    const row = workspace.querySelector(':scope > .query-bar-row') as Element;
    const shell = row.querySelector(':scope > .query-bar-shell') as Element;
    const clear = row.querySelector(':scope > [data-action="clear-query"]') as Element;
    const held = clear.getAttribute('aria-disabled') === 'true';
    row.querySelector(':scope > [data-action="apply-query"]')?.remove();
    clear.remove();
    const status = workspace.querySelector(':scope > .query-status') as Element;
    const toggle = status.querySelector(':scope > [data-action="toggle-builder"]') as Element;
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.remove();
    const group = make(`<div class="query-field-group"><button class="query-builder-toggle${open ? ' active' : ''}" data-action="toggle-builder" aria-expanded="${String(open)}" data-tip="Build the search one condition at a time">${HAMMER}Builder</button></div>`);
    row.insertBefore(group, shell);
    group.appendChild(shell);
    const list = shell.querySelector(':scope > [data-suggestions]');
    shell.insertBefore(make(`<button class="query-field-glyph query-clear" data-action="clear-query" aria-label="Clear the search" data-tip="Clear the search"${held ? ' hidden' : ''}>×</button>`), list);
    shell.insertBefore(make('<button class="query-field-glyph query-run" data-action="apply-query" aria-label="Search" data-tip="Run this search" data-tip-key="Enter">→</button>'), list);
    const hint = status.querySelector(':scope > .query-hint');
    if (hint) {
      hint.innerHTML = 'Enter searches. Words, #tags, is:open, has:due, in:folder; AND, OR, NOT.<span class="query-hint-key"> Press / to search.</span>';
      hint.classList.add('help-text');
    }
    for (const note of workspace.querySelectorAll('.query-builder-note')) {
      if (note.textContent?.startsWith('In a new row')) {
        note.classList.add('help-text');
      }
    }
    const builder = workspace.querySelector(':scope > .query-builder');
    if (builder) {
      workspace.insertBefore(builder, status);
    }
  }
  return normalizeBody(holder.firstElementChild as Element, { captured: true });
}

/** Fields added since the template was recorded, which its builder never listed. */
const FIELDS_SINCE_TEMPLATE = new Set(['status', 'cancelled']);

/** The host's view of a search, as a page is sent it, with the fields the template's builder knew. */
function viewOf(text: string, extra: Partial<QueryViewState> = {}, typed?: string): QueryViewState {
  const view = createQueryViewState({
      index: INDEX,
      parsed: parseQuery(text),
      matchCounts: { notes: 2, tasks: 3 },
      isAdvanced: true,
      recentQueries: ['is:open #project/atlas', 'due < 7d'],
      facets: FACETS,
      pending: typed,
      queryContext: QUERY_CONTEXT,
    });
  return {
    ...view,
    suggestions: { ...view.suggestions, fields: view.suggestions.fields.filter((field) => !FIELDS_SINCE_TEMPLATE.has(field.value)) },
    ...extra,
  };
}

/** What the page's script hands the suite. */
interface Harness {
  /** Delivers the host's next view of the search, and draws. */
  send(state: QueryViewState | undefined): void;
  /** Draws the page, as a page does after one of the editor's own changes. */
  draw(): void;
  /** What the box ran and cleared, in order. */
  readonly applied: string[];
  /** What a page that filters by plain words was told, in order. */
  readonly drafts: string[];
}

/** The script the page runs: an editor, a page that draws its bar and facets, and the listeners a page wires. */
const PAGE_SCRIPT = `
  let state;
  const applied = [];
  const drafts = [];
  const settings = { elsewhere: false };
  const options = {
    getState: function () { return state; },
    render: function () { draw(); },
    apply: function (text, record) { applied.push(text + (record ? '' : ' (step)')); },
    clear: function () { applied.push('<clear>'); },
    onDraft: function (text) { drafts.push(text); },
    placeholder: function () { return 'Search tasks: words, #tags, is:open…'; },
    label: 'Search tasks',
    resultKinds: ['tasks'],
    refineElsewhere: function () { return settings.elsewhere; },
    actions: ACTIONS,
  };
  const editor = createQueryEditor(options);
  function draw() {
    editor.beforeRender();
    DRAW;
    editor.afterRender();
  }
  document.addEventListener('mousedown', function (event) { editor.handleMousedown(event); });
  document.addEventListener('focusin', function (event) { editor.handleFocusIn(event); });
  document.addEventListener('click', function (event) { editor.handleClick(event); });
  document.addEventListener('keydown', function (event) { editor.handleKeydown(event); });
  document.addEventListener('input', function (event) { editor.handleInput(event); });
  document.addEventListener('change', function (event) { editor.handleChange(event); });
  window.harness = {
    send: function (next) { state = next; editor.receive(); draw(); },
    draw: draw,
    applied: applied,
    drafts: drafts,
    settings: settings,
  };
`;

/** A page running the shared search box, drawn with Preact. */
function corePage(): WebviewPage {
  const bundle = bundleShared(['queryEditor', 'queryText']);
  const script = PAGE_SCRIPT
    .replace('ACTIONS', `function (hasText) { return h('button', { 'data-action': 'save', 'data-query-needs-text': '', 'data-tip': 'Save', 'aria-disabled': hasText ? undefined : 'true' }, 'Save'); }`)
    .replace('DRAW', `render(h(Fragment, null, editor.bar(h('span', { class: 'control-label' }, 'Sorted')), editor.facets()), document.getElementById('app'))`);
  const page = `${bundle}\n(function () {\n  const { createQueryEditor, h, render, Fragment } = window.shared;\n${script}\n}());`;
  return openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${page}</script></body></html>`);
}

suite('The shared search box draws and does what the template script did', () => {
  let core: WebviewPage;
  /** The running test's title, which names its steps' recordings. */
  let running = '';
  setup(function () {
    running = this.currentTest?.title ?? '';
    core = corePage();
  });
  teardown(() => {
    core.dispose();
  });

  const harness = (page: WebviewPage): Harness & { settings: { elsewhere: boolean } } =>
    (page.window as unknown as { harness: Harness & { settings: { elsewhere: boolean } } }).harness;
  /** Does something on the page under test. */
  const onPage = (act: (page: WebviewPage) => void): void => act(core);
  /** Where focus is, said by what the focused element is, as the recording says it. */
  const focusOf = (page: WebviewPage): string => {
    const active = page.document.activeElement as HTMLInputElement | null;
    if (!active || active === page.document.body) {
      return 'body';
    }
    const caret = typeof active.selectionStart === 'number' ? ` caret ${active.selectionStart}-${active.selectionEnd}` : '';
    return `${active.tagName} ${active.getAttribute('data-action') ?? ''} ${active.getAttribute('data-path') ?? ''}${caret}`;
  };
  /**
   * The page draws what the template drew at this step, ran the same, and
   * has focus in the same place. With `focusKept`, a field the template's
   * draw took away, leaving focus on the page, may keep it here: Preact
   * keeps the element.
   */
  const assertSame = (what: string, focusKept = false): void => {
    const before = doneByTemplate<StepRecord>(`${running}: ${what}`);
    assert.strictEqual(normalizeBody(core.find('#app')), asDrawnSinceTemplate(core, before.page), `${what}: the page`);
    assert.deepStrictEqual([...harness(core).applied], before.ran, `${what}: what was run`);
    assert.deepStrictEqual([...harness(core).drafts], before.typed, `${what}: what was typed`);
    if (focusKept && before.focus === 'body') {
      return;
    }
    assert.strictEqual(focusOf(core), before.focus, `${what}: where focus is`);
  };
  const send = (state: QueryViewState | undefined): void => onPage((page) => harness(page).send(JSON.parse(JSON.stringify(state ?? null)) ?? undefined));
  const click = (selector: string, init: MouseEventInit = {}): void => onPage((page) => {
    page.find(selector).dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
  const key = (selector: string, keyName: string, init: KeyboardEventInit = {}): void => onPage((page) => {
    page.find(selector).dispatchEvent(new page.window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }));
  });
  const type = (selector: string, text: string): void => onPage((page) => {
    const field = page.find(selector) as HTMLInputElement;
    field.focus();
    field.value = text;
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  });
  const change = (selector: string, value: string): void => onPage((page) => {
    const field = page.find(selector) as HTMLSelectElement;
    field.value = value;
    field.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  });

  test('the bar, its terms, its status line, and its facets, for each kind of search', () => {
    send(undefined);
    assertSame('no search yet');
    const searches: Array<[string, QueryViewState]> = [
      ['an empty search', viewOf('')],
      ['tags, a word, and a negated tag', viewOf('#project/atlas AND vendor AND -#context/phone')],
      ['a group and an OR', viewOf('is:open AND (#project/atlas OR #project/beta) AND NOT (due < 7d OR has:due)')],
      ['a link, negated', viewOf('-[[Atlas plan]] AND text ~ "lift stuck"')],
      ['one that does not parse', viewOf('is:open', {}, 'is:open AND (')],
      ['one that matched nothing', viewOf('is:open AND #project/beta', { matchCounts: { notes: 0, tasks: 0 } })],
      ['one that matched nothing, with one term', viewOf('#project/beta', { matchCounts: { notes: 0, tasks: 0 } })],
      ['one with nothing to narrow by', viewOf('is:open', { facets: [] })],
    ];
    for (const [what, state] of searches) {
      send(state);
      assertSame(what);
    }
    onPage((page) => {
      harness(page).settings.elsewhere = true;
    });
    for (const [what, state] of searches) {
      send(state);
      assertSame(`${what}, with Refine in the sidebar`);
    }
  });

  test('more of a facet, and fewer', () => {
    send(viewOf('is:open'));
    click('[data-action="facet-more"][data-facet-id="status"]');
    assertSame('opened');
    click('[data-action="facet-more"][data-facet-id="status"]');
    assertSame('closed');
  });

  test('a facet value narrows, leaves out, or widens the search', () => {
    send(viewOf('is:open'));
    click('[data-action="facet"][data-clause="#project/atlas"]');
    click('[data-action="facet"][data-clause="#project/atlas"]', { altKey: true });
    // When the template was recorded, status was another name for task, so
    // `status = s0` was a search Deckard could not read. It reads now, as a
    // status's name, so the search is sent as it was then: task's error,
    // under the words as written.
    const applied = viewOf('is:open AND task = s0', { facets: FACETS.map((facet) => (facet.id === 'status' ? { ...facet, applied: ['status = s0'] } : facet)) });
    send(JSON.parse(JSON.stringify(applied).replace(/task = s0/g, 'status = s0')) as QueryViewState);
    click('[data-action="facet"][data-clause="status = s1"]', { shiftKey: true });
    assertSame('three refinements');
  });

  test('typing offers completions, the arrows walk them, and Enter or Tab takes one', () => {
    send(viewOf('is:open'));
    type('[data-action="query-input"]', '#proj');
    assertSame('a tag being typed');
    key('[data-action="query-input"]', 'ArrowDown');
    key('[data-action="query-input"]', 'ArrowDown');
    assertSame('the second completion highlighted');
    key('[data-action="query-input"]', 'ArrowUp');
    key('[data-action="query-input"]', 'Enter');
    assertSame('the first completion taken');
    send(viewOf('is:open AND #project/atlas'));
    assertSame('the host answered');
    type('[data-action="query-input"]', 'due <');
    type('[data-action="query-input"]', 'pri');
    key('[data-action="query-input"]', 'Tab');
    assertSame('a field taken with Tab, waiting for its value');
    key('[data-action="query-input"]', 'Escape');
    key('[data-action="query-input"]', 'Escape');
    assertSame('Escape closed the list, then let go of the term');
  });

  test('an empty bar offers recent searches when focused, and a recent search runs whole', () => {
    send(viewOf(''));
    onPage((page) => (page.find('[data-action="query-input"]') as HTMLElement).focus());
    assertSame('recent searches');
    onPage((page) => page.find('[data-action="query-suggestion"][data-suggestion-index="1"]').dispatchEvent(new page.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    click('[data-action="query-suggestion"][data-suggestion-index="1"]');
    assertSame('a recent search ran');
  });

  test('Enter runs what was typed, a chip removes its term, and Backspace the last one', () => {
    send(viewOf('is:open AND #project/atlas'));
    type('[data-action="query-input"]', 'vendor');
    key('[data-action="query-input"]', 'Enter');
    send(viewOf('is:open AND #project/atlas AND vendor'));
    assertSame('a word added');
    click('[data-action="remove-term"][data-without="is:open AND vendor"]');
    send(viewOf('is:open AND vendor'));
    assertSame('a chip removed');
    key('[data-action="query-input"]', 'Backspace');
    assertSame('the last chip removed');
    click('[data-action="apply-query"]');
    assertSame('Search');
  });

  test('typing enables the buttons that need text in place, and Clear empties the search', () => {
    send(viewOf(''));
    type('[data-action="query-input"]', 'vend');
    assertSame('typed');
    type('[data-action="query-input"]', '');
    assertSame('emptied');
    send(viewOf('is:open'));
    type('[data-action="query-input"]', 'x');
    click('[data-action="clear-query"]');
    assertSame('cleared');
    send(viewOf(''));
    assertSame('the host answered the clear');
  });

  test('the builder opens with a row to type in, takes conditions, groups, and edits', () => {
    /** The host's answer to the search the builder ran last, with focus let go where the two may differ. */
    const answer = (): void => {
      const ran = harness(core).applied;
      send(viewOf(ran[ran.length - 1].replace(/ \(step\)$/, '')));
      onPage((page) => (page.document.activeElement as HTMLElement | null)?.blur());
    };
    send(viewOf('is:open AND (#project/atlas OR text ~ vendor) AND link = [[Atlas]] AND priority >= high'));
    click('[data-action="toggle-builder"]');
    assertSame('opened');
    type('[data-action="builder-set-value"][data-pending="true"]', 'due');
    assertSame('a new row being typed');
    key('[data-action="builder-set-value"][data-pending="true"]', 'Enter');
    assertSame('the new row committed');
    send(viewOf('is:open AND (#project/atlas OR text ~ vendor) AND link = [[Atlas]] AND priority >= high AND text ~ due'));
    assertSame('the host answered the row', true);
    onPage((page) => (page.document.activeElement as HTMLElement | null)?.blur());
    change('[data-action="builder-set-join"][data-path="1"]', 'and');
    change('[data-action="builder-set-operator"][data-path="3"]', 'lt');
    change('[data-action="builder-set-field"][data-path="0"]', 'kind');
    assertSame('a join, an operator, and a field changed');
    answer();
    click('[data-action="builder-toggle-not"][data-path="1"]');
    answer();
    click('[data-action="builder-add-group"][data-path=""]');
    assertSame('a group turned around, and a group added', true);
    key('[data-action="builder-set-value"][data-pending="true"]', 'Backspace');
    click('[data-action="builder-remove-row"][data-path="2"]');
    answer();
    click('[data-action="builder-remove-group"][data-path="1"]');
    answer();
    assertSame('a row and a group removed', true);
    click('[data-action="builder-add-row"][data-path=""]');
    type('[data-action="builder-set-value"][data-pending="true"]', '#proj');
    assertSame('completions in a new row');
    key('[data-action="builder-set-value"][data-pending="true"]', 'ArrowDown');
    key('[data-action="builder-set-value"][data-pending="true"]', 'Enter');
    assertSame('a completion taken in a new row');
    click('[data-action="toggle-builder"]');
    assertSame('closed');
  });

  test('a word every object inherits, such as constructor, is no field, as in the host\'s parser', () => {
    const shared = (core.window as unknown as {
      shared: {
        fieldFor(word: string, aliases: Record<string, string>): unknown;
        parseConditionText(text: string, aliases: Record<string, string>): unknown;
        valueContext(prefix: string, aliases: Record<string, string>): unknown;
      };
    }).shared;
    // The aliases arrive from the host as a copy, an object like any other.
    const aliases = core.window.JSON.parse(JSON.stringify(viewOf('').suggestions.aliases)) as Record<string, string>;
    for (const word of ['constructor', 'toString', '__proto__']) {
      assert.strictEqual(shared.fieldFor(word, aliases), undefined, word);
      assert.strictEqual(shared.valueContext(`${word}:x`, aliases), undefined, word);
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(shared.parseConditionText(`${word}:x`, aliases))),
        { field: 'text', operator: 'contains', value: `${word}:x`, supported: true, text: '' },
        word,
      );
    }
    assert.strictEqual(shared.fieldFor('due', aliases), 'due', 'a field still is one');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(shared.valueContext('is:ov', aliases))), { field: 'is', token: 'ov' });
  });

  test('the plain words of a search, which a page filters by at once', () => {
    const shared = (core.window as unknown as { shared: { previewWords(text: string): string[] } }).shared;
    for (const text of ['vendor review', 'vendor = x review', 'a OR b', 'tag = #x word', '#tag word -no "quoted" and && w', 'due <= 7d plan']) {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(shared.previewWords(text))), doneByTemplate<string[]>(`plain words of ${text}`), text);
    }
  });
});
