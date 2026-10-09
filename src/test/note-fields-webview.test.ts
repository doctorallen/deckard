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

/** Types into an input as a reader would, one input event. */
function type(page: WebviewPage, selector: string, text: string): void {
  const input = page.find(selector) as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
}

/** Presses a key on an element. */
function press(page: WebviewPage, selector: string, key: string): void {
  page.find(selector).dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Each field row's key and values, as drawn. */
function rows(page: WebviewPage, scope = ''): Array<[string, string]> {
  return page.findAll(`${scope} .field-row`).map((row) => [
    row.querySelector('.field-name')?.textContent ?? '',
    [...(row.querySelector('.field-values')?.childNodes ?? [])].filter((node) => !(node instanceof page.window.HTMLElement && node.classList.contains('field-edit'))).map((node) => node.textContent).join(''),
  ]);
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

  test('draws a reverse in italics with what it is worked out from, and no Edit', () => {
    const page = notePage('Teams/Rates.md');
    const members = page.findAll('.field-row').find((row) => row.querySelector('.field-name')?.textContent === 'members');
    assert.ok(members?.classList.contains('is-reverse'));
    assert.strictEqual(members?.querySelector('.field-name')?.getAttribute('data-tip'), "From each person's team");
    assert.strictEqual(members?.querySelector('.field-edit'), null);
  });

  test('folds the empty fields into one line that opens to list them', () => {
    const page = notePage('Teams/Credit.md');
    assert.strictEqual(page.text('.field-empty > summary'), '3 empty: owns, on-call, status');
    assert.deepStrictEqual(rows(page, '.field-empty').map(([name]) => name), ['owns', 'on-call', 'status']);
  });

  test('Edit opens a list of people filtered as you type, and Enter takes the first', () => {
    const page = notePage('Teams/Rates.md');
    const edit = page.find('.field-edit[data-field-key="lead"]');
    assert.strictEqual(edit.getAttribute('data-reveal'), '', 'revealed on its row, as a row’s ⋯ is');
    assert.strictEqual(edit.getAttribute('data-zen-reveal'), '');
    page.click('.field-edit[data-field-key="lead"]');
    assert.strictEqual(page.find('.field-edit[data-field-key="lead"]').getAttribute('aria-expanded'), 'true');
    assert.deepStrictEqual(page.findAll('.field-editor .field-choice-title').map((title) => title.textContent), ['Dana Whitfield', 'Omar Haddad', 'Priya Natarajan']);
    assert.strictEqual(page.find('.field-editor [data-row-id="@dana"]').getAttribute('aria-pressed'), 'true');
    type(page, '.field-editor .field-input', 'om');
    assert.deepStrictEqual(page.findAll('.field-editor .field-choice-title').map((title) => title.textContent), ['Omar Haddad']);
    press(page, '.field-editor .field-input', 'Enter');
    assert.deepStrictEqual(page.lastPosted('setNoteField'), { type: 'setNoteField', filePath: 'Teams/Rates.md', key: 'lead', value: { kind: 'row', rowId: '@omar' } });
    assert.strictEqual(page.findAll('.field-editor').length, 0, 'a field that holds one closes once chosen');
  });

  test('Enter on a focused row opens its editor, and Escape closes it', () => {
    const page = notePage('Teams/Rates.md');
    const row = page.find('.field-row[data-field-key="tier"]');
    assert.strictEqual(row.getAttribute('tabindex'), '0');
    press(page, '.field-row[data-field-key="tier"]', 'Enter');
    assert.deepStrictEqual(page.findAll('.field-editor .field-choice').map((option) => [option.textContent, option.getAttribute('aria-pressed')]), [['gold', 'true'], ['silver', 'false'], ['bronze', 'false']]);
    page.click('.field-editor [data-option="silver"]');
    assert.deepStrictEqual(page.lastPosted('setNoteField'), { type: 'setNoteField', filePath: 'Teams/Rates.md', key: 'tier', value: { kind: 'option', option: 'silver' } });
    press(page, '.field-row[data-field-key="tier"]', 'Enter');
    press(page, '.field-editor .field-choice', 'Escape');
    assert.strictEqual(page.findAll('.field-editor').length, 0);
  });

  test('a field that holds several keeps its list open for the next choice, and Clear empties it', () => {
    const page = notePage('Teams/Rates.md');
    page.click('.field-edit[data-field-key="owns"]');
    page.click('.field-editor [data-row-id="#area/fx"]');
    assert.deepStrictEqual(page.lastPosted('setNoteField')?.value, { kind: 'row', rowId: '#area/fx' });
    assert.strictEqual(page.findAll('.field-editor').length, 1, 'still open');
    page.click('.field-editor [data-action="clear-field"]');
    assert.deepStrictEqual(page.lastPosted('setNoteField')?.value, { kind: 'clear' });
  });

  test('a date, a number, and a box each have their input', () => {
    const page = notePage('People/Dana Whitfield.md');
    page.click('.field-edit[data-field-key="start"]');
    const date = page.find('.field-editor input[type="date"]') as HTMLInputElement;
    assert.strictEqual(date.value, '2026-03-01');
    type(page, '.field-editor .field-input', '2026-04-01');
    page.click('.field-editor [data-action="set-field-text"]');
    assert.deepStrictEqual(page.lastPosted('setNoteField')?.value, { kind: 'text', text: '2026-04-01' });
    page.click('.field-edit[data-field-key="remote"]');
    page.click('.field-editor input[type="checkbox"]');
    assert.deepStrictEqual(page.lastPosted('setNoteField'), { type: 'setNoteField', filePath: 'People/Dana Whitfield.md', key: 'remote', value: { kind: 'checkbox', checked: false } });
  });

  test('Add field… lists the empty fields, then Other… for a key of one’s own', () => {
    const page = notePage('Teams/Credit.md');
    const add = page.find('.field-add-button');
    assert.strictEqual(add.getAttribute('data-zen-reveal'), '');
    page.click('.field-add-button');
    assert.deepStrictEqual(page.findAll('.field-add .field-choice').map((choice) => choice.textContent), ['owns', 'on-call', 'status', 'Other…']);
    page.click('.field-add [data-field-key="status"]');
    assert.ok(page.find('.field-row[data-field-key="status"] .field-editor'), 'the empty field’s editor opens in its fold');
    assert.strictEqual((page.find('.field-empty') as HTMLDetailsElement).open, true);
    page.click('.field-add-button');
    page.click('.field-add [data-action="add-other-field"]');
    type(page, '.field-add .field-key-input', 'pager');
    type(page, '.field-add .field-input', 'credit-oncall');
    press(page, '.field-add .field-input', 'Enter');
    assert.deepStrictEqual(page.lastPosted('setNoteField'), { type: 'setNoteField', filePath: 'Teams/Credit.md', key: 'pager', value: { kind: 'text', text: 'credit-oncall' } });
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
    assert.strictEqual(plain.findAll('.field-edit, .field-add-button').length, 0);
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

  test('a typed row’s hub card draws its fields, read-only', () => {
    const page = searchPage('#team/rates');
    assert.deepStrictEqual(rows(page, '.hub').slice(0, 2), [['lead', 'Dana Whitfield'], ['owns', 'Bond Trading, Fx']]);
    assert.strictEqual(page.findAll('.hub .field-edit, .hub .hub-properties').length, 0);
  });

  test('a typed row with no note gets a Fields card in the hub’s place, with who owns it', () => {
    const page = searchPage('#area/bond-trading');
    assert.strictEqual(page.text('details.hub-fields-card > summary .eyebrow'), 'Fields');
    assert.deepStrictEqual(rows(page, '.hub-fields-card'), [['owned by', 'Rates (lead Dana Whitfield · on-call Priya Natarajan)']]);
    assert.strictEqual(page.find('.hub-offer-link').textContent, 'Create hub note', 'Create hub note stays under the title');
  });
});
