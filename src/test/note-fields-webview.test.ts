import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { createPreferences } from './preferenceServices';
import { renderPage } from './pages';
import { indexOf, now, typedWorkspace } from './typedWorkspace';
import { openWebviewPage, type WebviewPage } from './webviewPage';

const index = typedWorkspace();
const options = { queryContext: createQueryContext(now), history: { back: false, forward: false }, visit: 1 };

const pages: WebviewPage[] = [];

/** The Note page drawing one note of the typed workspace. */
function notePage(filePath: string): WebviewPage {
  const page = openWebviewPage(renderPage('notePage'), createNotePageSnapshot(index, filePath, options));
  pages.push(page);
  return page;
}

/** Each field row's key and values, as drawn, where it is set aside. */
function rows(page: WebviewPage, scope = ''): Array<[string, string]> {
  return page.findAll(`${scope} .field-row`).map((row) => [
    row.querySelector('.field-name')?.textContent ?? '',
    [...(row.querySelector('.field-values')?.childNodes ?? [])]
      .filter((node) => !(node instanceof page.window.HTMLElement && node.classList.contains('field-source')))
      .map((node) => node.textContent)
      .join(''),
  ]);
}

/** The field row named `name`. */
function rowNamed(page: WebviewPage, name: string, scope = ''): Element | undefined {
  return page.findAll(`${scope} .field-row`).find((row) => row.querySelector('.field-name')?.textContent === name);
}

suite('Note page fields, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  test('draws a typed row’s fields under the bar, in a region of their own, not in the bar’s lead', () => {
    const page = notePage('Teams/Rates.md');
    const region = page.find('main > section.note-fields');
    assert.strictEqual(region.getAttribute('data-zen-region'), '');
    assert.strictEqual(page.findAll('.page-bar .note-properties, .page-bar .field-rows').length, 0, 'nothing of the front matter stays in the bar');
    assert.deepStrictEqual(rows(page).slice(0, 3), [['lead', 'Dana Whitfield'], ['owns', 'Bond Trading, Fx'], ['tier', 'gold']]);
    assert.strictEqual(page.findAll('.field-row .field-name').some((name) => name.textContent === 'describes'), false);
  });

  test('a person opens its tag, and the hub line’s type opens its rows', () => {
    const page = notePage('Teams/Rates.md');
    const lead = page.find('.field-row[data-field-key="lead"] .field-link');
    assert.deepStrictEqual([lead.textContent, lead.getAttribute('data-action'), lead.getAttribute('data-tag-key')], ['Dana Whitfield', 'open-tag', '@dana']);
    page.click('.field-row[data-field-key="lead"] .field-link');
    assert.deepStrictEqual(page.lastPosted('openTag'), { type: 'openTag', tagKey: '@dana' });
    const type = page.find('.note-progress .type-link');
    assert.strictEqual(type.textContent, 'Team');
    page.click('.note-progress .type-link');
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: 'type = team' });
  });

  test('draws the reverses after the note’s own fields, under From other notes, each in italics saying where it is set, with no Edit', () => {
    const page = notePage('Teams/Rates.md');
    const lists = page.findAll('.note-fields > .field-rows, .note-fields > .field-group-label');
    assert.deepStrictEqual(lists.map((list) => list.className), ['field-rows', 'field-group-label', 'field-rows field-reverses']);
    assert.strictEqual(page.text('.field-group-label'), 'From other notes');
    assert.strictEqual(page.find('.field-group-label').classList.contains('eyebrow'), false, 'a label Zen keeps, not an eyebrow');
    assert.deepStrictEqual(rows(page, '.field-reverses').map(([name]) => name), ['members', 'team of']);
    assert.ok(!rows(page, '.note-fields > .field-rows:not(.field-reverses)').some(([name]) => name === 'members'));
    const members = rowNamed(page, 'members');
    assert.ok(members?.classList.contains('is-reverse'));
    assert.strictEqual(members?.querySelector('.field-source')?.textContent, "Set in Dana Whitfield's team");
    assert.strictEqual(members?.querySelector('.field-source code')?.textContent, 'team', 'the field it is set in, in monospace');
    assert.strictEqual(rowNamed(page, 'team of')?.querySelector('.field-source')?.textContent, "Set in RFQ outage's team");
    assert.strictEqual(members?.querySelector('.field-name-link'), null, 'a reverse is set on the other rows, so its name opens nothing');
    assert.strictEqual(rowNamed(page, 'lead')?.querySelector('.field-source'), null, 'a field the note writes says nothing of where');
  });

  test('edits nothing in place: no Edit on a row, no editor, no Add field…, and no line of empty fields', () => {
    const page = notePage('Teams/Credit.md');
    assert.strictEqual(page.findAll('.field-edit, .field-editor, .field-add, .field-add-button, .field-empty, .field-choice, .field-input').length, 0);
    assert.strictEqual(page.findAll('.field-row[tabindex]').length, 0, 'a row is no stop of its own; its name is');
    assert.deepStrictEqual(rows(page).map(([name]) => name), ['lead', 'tier', 'headcount', 'members', 'team of']);
  });

  test('a field’s name is a quiet link that opens the form on that field', () => {
    const page = notePage('Teams/Rates.md');
    const name = page.find('.field-row[data-field-key="tier"] .field-name-link');
    assert.deepStrictEqual([name.tagName, name.textContent, name.getAttribute('data-action'), name.getAttribute('data-zen-reveal')], ['BUTTON', 'tier', 'edit-fields', null]);
    page.click('.field-row[data-field-key="tier"] .field-name-link');
    assert.deepStrictEqual(page.lastPosted('editFields'), { type: 'editFields', filePath: 'Teams/Rates.md', field: 'tier' });
  });

  test('Edit fields… ends the fields region, and ⋯ Page has it too, each opening the form on the note', () => {
    const page = notePage('Teams/Rates.md');
    const edit = page.find('.note-fields > .note-fields-edit > button');
    assert.deepStrictEqual([edit.textContent, edit.getAttribute('data-action'), edit.getAttribute('data-zen-reveal')], ['Edit fields…', 'edit-fields', '']);
    assert.strictEqual(page.findAll('.note-fields [data-action="edit-fields"]:not(.field-name-link)').length, 1, 'one Edit fields… in the region');
    page.click('.note-fields-edit > button');
    assert.deepStrictEqual(page.lastPosted('editFields'), { type: 'editFields', filePath: 'Teams/Rates.md' });
    const menu = page.findAll('[data-action="edit-fields"]').filter((item) => !item.closest('.note-fields'));
    assert.deepStrictEqual(menu.map((item) => item.textContent?.trim()), ['Edit fields…'], '⋯ Page lists it once');
  });

  test('a note row names its type above its fields; a note no type has keeps its properties, in the same region', () => {
    const outage = notePage('Incidents/RFQ outage.md');
    assert.strictEqual(outage.text('.note-fields .note-fields-type .type-link'), 'Incident');
    const plain = openWebviewPage(
      renderPage('notePage'),
      createNotePageSnapshot(indexOf({ 'notes/props.md': '---\nstatus: active\n---\n# Props' }), 'notes/props.md', options),
    );
    pages.push(plain);
    assert.ok(plain.find('main > section.note-fields .note-properties'));
    assert.strictEqual(plain.findAll('[data-action="edit-fields"]').length, 0, 'a note no type has has no fields to edit');
  });
});

suite('Tag page fields, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  const searchPage = (query: string): WebviewPage => {
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      const page = openWebviewPage(renderPage('searchPage'), createSearchPageSnapshot(index, store.reader.value, query, { queryContext: createQueryContext(now) }));
      pages.push(page);
      return page;
    } finally {
      store.repository.dispose();
    }
  };

  test('a typed row’s hub card draws its fields, each own name opening the form, and Edit fields… beside Open', () => {
    const page = searchPage('#team/rates');
    assert.deepStrictEqual(rows(page, '.hub').slice(0, 2), [['lead', 'Dana Whitfield'], ['owns', 'Bond Trading, Fx']]);
    assert.strictEqual(page.findAll('.hub .hub-properties').length, 0);
    assert.strictEqual(page.findAll('.hub .field-edit, .hub .field-add-button, .hub .field-empty, .hub .field-editor').length, 0, 'nothing is edited in place');
    const header = page.find('details.hub:not(.hub-fields-card) > summary.hub-header');
    assert.strictEqual(header.getAttribute('data-zen-region'), '');
    assert.deepStrictEqual(page.findAll('.hub-header .hub-actions > button').map((button) => button.textContent), ['Edit fields…', 'Open Rates.md']);
    const edit = page.find('.hub-header [data-action="edit-fields"]');
    assert.strictEqual(edit.getAttribute('data-zen-reveal'), '');
    page.click('.hub-header [data-action="edit-fields"]');
    assert.deepStrictEqual(page.lastPosted('editFields'), { type: 'editFields', filePath: 'Teams/Rates.md' });
    page.click('.hub .field-row[data-field-key="lead"] .field-name-link');
    assert.deepStrictEqual(page.lastPosted('editFields'), { type: 'editFields', filePath: 'Teams/Rates.md', field: 'lead' });
    assert.strictEqual(rowNamed(page, 'members', '.hub')?.querySelector('.field-name-link'), null, 'a reverse is set on the other rows');
  });

  test('a hub note no type has keeps its Open alone', () => {
    const page = searchPage('#team/rates');
    assert.strictEqual(page.findAll('details.hub-fields-card').length, 0);
    const plain = openWebviewPage(
      renderPage('searchPage'),
      (() => {
        const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
        try {
          return createSearchPageSnapshot(indexOf({ 'notes/hub.md': '---\ndescribes: "#project/atlas"\n---\n# Atlas', 'notes/a.md': '# A #project/atlas' }), store.reader.value, '#project/atlas', { queryContext: createQueryContext(now) });
        } finally {
          store.repository.dispose();
        }
      })(),
    );
    pages.push(plain);
    assert.strictEqual(plain.findAll('.hub-header [data-action="edit-fields"], .hub-actions').length, 0);
    assert.strictEqual(plain.find('.hub-header').getAttribute('data-zen-region'), null);
  });

  test('a typed row with no note gets a Fields card in the hub’s place: no note yet, Add fields…, then who owns it from other notes', () => {
    const page = searchPage('#area/bond-trading');
    assert.strictEqual(page.text('details.hub-fields-card > summary .eyebrow'), 'Fields');
    assert.strictEqual(page.find('.hub-fields-card .hub-fields-none').firstChild?.textContent, 'No note describes #area/bond-trading yet. ');
    assert.deepStrictEqual(rows(page, '.hub-fields-card'), [['owned by', 'Rates (lead Dana Whitfield · on-call Priya Natarajan)']], 'its own fields are no longer listed Not set');
    assert.strictEqual(page.text('.hub-fields-card .field-group-label'), 'From other notes');
    assert.strictEqual(rowNamed(page, 'owned by')?.querySelector('.field-source')?.textContent, "Set in Rates' owns");
    assert.strictEqual(page.find('.hub-offer-link').textContent, 'Create hub note', 'Create hub note stays under the title');
    assert.strictEqual(page.findAll('.hub-fields-card .field-name-link, .hub-fields-card .field-edit').length, 0);
  });

  test('on the Fields card, Add fields… opens the form for the row’s note, and Zen quiets it in place', () => {
    const page = searchPage('#area/bond-trading');
    const add = page.find('.hub-fields-card .hub-fields-add');
    assert.deepStrictEqual([add.textContent, add.getAttribute('data-action'), add.getAttribute('data-zen-reveal')], ['Add fields…', 'create-hub', '']);
    assert.strictEqual(add.closest('[data-zen-region]'), page.find('.hub-fields-card .hub-fields'));
    page.click('.hub-fields-card .hub-fields-add');
    assert.deepStrictEqual(page.lastPosted('createHubNote'), { type: 'createHubNote' });
  });
});
