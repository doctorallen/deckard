import * as assert from 'assert';

import { getTypeIndex } from '../domain/types/typeIndex';
import {
  checkFieldText,
  checkTypedNoteDraft,
  draftNotePath,
  draftTagOf,
  listDraftFields,
  planTypedNote,
  readDraftFolder,
  readDraftTag,
  readFieldText,
  setDraftValues,
  startTypedNoteDraft,
  writeDraftValues,
  type DraftType,
} from '../domain/types/typedNoteDraft';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const index = typedWorkspace();
const types = getTypeIndex(index);

/** A type of the typed workspace, which every test expects there. */
function typeOf(key: string): DraftType {
  const type = types.registry.get(key);
  assert.ok(type, key);
  return type;
}

/** A schema field of a type of the typed workspace. */
function fieldOf(typeKey: string, key: string): DraftType['fields'][number] {
  const field = typeOf(typeKey).fields.find((each) => each.key === key);
  assert.ok(field, key);
  return field;
}

suite('A new note of a type', () => {
  test('starts in the type\'s folder, its tag following its title until one is given', () => {
    const team = typeOf('team');
    const draft = startTypedNoteDraft(team, { title: ' Risk Tech ' });
    assert.deepStrictEqual(draft, { typeKey: 'team', title: 'Risk Tech', folder: 'Teams', values: {} });
    assert.strictEqual(draftTagOf(team, draft), '#team/risk-tech');
    assert.strictEqual(draftTagOf(team, { ...draft, title: 'Rates EMEA' }), '#team/rates-emea');
    assert.strictEqual(draftNotePath(draft), 'Teams/Risk Tech.md');
    assert.strictEqual(draftNotePath({ title: 'Risk', folder: '' }), 'Risk.md');

    const given = startTypedNoteDraft(team, { title: 'Rates', tag: '#team/rates/emea' });
    assert.strictEqual(given.tagFixed, true);
    assert.strictEqual(draftTagOf(team, given), '#team/rates/emea');

    const incident = typeOf('incident');
    const note = startTypedNoteDraft(incident, { title: 'Feed outage', tag: '#team/x' });
    assert.strictEqual(note.tag, undefined, 'a note type has no tag');
    assert.strictEqual(draftTagOf(incident, note), undefined);
    assert.strictEqual(note.folder, 'Incidents');
  });

  test('a typed tag is read under the type\'s namespace, nested or not', () => {
    const team = typeOf('team');
    assert.strictEqual(readDraftTag(team, 'risk'), '#team/risk');
    assert.strictEqual(readDraftTag(team, '#team/risk'), '#team/risk');
    assert.strictEqual(readDraftTag(team, 'team/rates/emea'), '#team/rates/emea');
    assert.strictEqual(readDraftTag(team, ''), undefined);
    assert.strictEqual(readDraftTag(team, 'two words'), undefined);
    const person = typeOf('person');
    assert.strictEqual(readDraftTag(person, 'omar-h'), '@omar-h');
    assert.strictEqual(readDraftTag(person, '@omar'), '@omar');
    assert.strictEqual(readDraftTag(person, '#person/omar'), '@omar');
    assert.strictEqual(readDraftTag(typeOf('incident'), 'x'), undefined);
  });

  test('a folder is read with / between its parts, and . or .. refused', () => {
    assert.strictEqual(readDraftFolder(' /Teams/EMEA/ '), 'Teams/EMEA');
    assert.strictEqual(readDraftFolder('Teams\\EMEA'), 'Teams/EMEA');
    assert.strictEqual(readDraftFolder(''), '');
    assert.strictEqual(readDraftFolder('../out'), undefined);
    assert.strictEqual(readDraftFolder('a:b'), undefined);
  });

  test('lists the schema\'s fields in order, but a row\'s identity', () => {
    assert.deepStrictEqual(listDraftFields(typeOf('team')).map((field) => field.key), ['lead', 'owns', 'tier', 'headcount', 'on-call', 'status']);
    const withIdentity: DraftType = { ...typeOf('incident'), fields: [...typeOf('incident').fields, { ...fieldOf('incident', 'owner'), key: 'type', name: 'type' }] };
    assert.deepStrictEqual(listDraftFields(withIdentity).map((field) => field.key), ['owner', 'team', 'severity']);
  });

  test('writes each field set in Deckard\'s form by kind, the others left as keys', () => {
    const team = typeOf('team');
    let draft = startTypedNoteDraft(team, { title: 'Risk Tech' });
    draft = setDraftValues(draft, 'lead', [{ text: '@dana', title: 'Dana Whitfield' }]);
    draft = setDraftValues(draft, 'owns', [{ text: '#area/fx' }, { text: '#area/bond-trading' }]);
    draft = setDraftValues(draft, 'tier', [{ text: 'gold' }]);
    draft = setDraftValues(draft, 'headcount', [{ text: '12' }]);
    const plan = planTypedNote(team, draft, { now: new Date(now) });
    assert.deepStrictEqual(plan, {
      folder: 'Teams',
      fileName: 'Risk Tech.md',
      path: 'Teams/Risk Tech.md',
      tag: '#team/risk-tech',
      content: [
        '---',
        'describes: "#team/risk-tech"',
        'lead: "@dana"',
        'owns: ["#area/fx", "#area/bond-trading"]',
        'tier: gold',
        'headcount: 12',
        'on-call:',
        'status:',
        '---',
        '# Risk Tech',
        '',
        '',
      ].join('\n'),
      unwritten: [],
    });
    // The note reads back as a row of its type with the values set.
    const base = Object.fromEntries([...(index.typeNotes ?? new Map())].map(([path, file]) => [path, file.content]));
    const read = getTypeIndex(indexOf({ ...base, ...Object.fromEntries([...index.files].map(([path, file]) => [path, file.content])), [plan?.path ?? '']: plan?.content ?? '' }));
    const row = read.rowOfTag('#team/risk-tech');
    assert.ok(row);
    assert.deepStrictEqual(read.field(row.id, 'lead', now)?.values.map((value) => value.rowId), ['@dana']);
    assert.deepStrictEqual(read.field(row.id, 'owns', now)?.values.map((value) => value.rowId), ['#area/fx', '#area/bond-trading']);
  });

  test('a note type writes type:, a relation to it as a link, dates as ISO, a checkbox bare', () => {
    const incident = typeOf('incident');
    let draft = startTypedNoteDraft(incident, { title: 'Feed outage' });
    draft = setDraftValues(draft, 'owner', [{ text: 'Omar H' }]);
    draft = setDraftValues(draft, 'severity', [{ text: 'sev1' }]);
    assert.strictEqual(
      planTypedNote(incident, draft, { now: new Date(now) })?.content,
      '---\ntype: incident\nowner: Omar H\nteam:\nseverity: sev1\n---\n# Feed outage\n\n',
    );
    const person = typeOf('person');
    let dana = startTypedNoteDraft(person, { title: 'Lena Park' });
    dana = setDraftValues(dana, 'start', [{ text: '2026-03-01' }]);
    dana = setDraftValues(dana, 'remote', [{ text: 'false' }]);
    dana = setDraftValues(dana, 'email', [{ text: 'lena@example.com' }]);
    assert.strictEqual(
      planTypedNote(person, dana, { now: new Date(now) })?.content,
      '---\ndescribes: "@lena-park"\nteam:\nemail: lena@example.com\nstart: 2026-03-01\nremote: false\n---\n# Lena Park\n\n',
    );
    assert.deepStrictEqual(writeDraftValues({ name: 'note', many: false }, [{ text: '[[RFQ outage]]' }]), { values: [{ text: '[[RFQ outage]]' }], list: false });
    assert.deepStrictEqual(writeDraftValues({ name: 'number', many: false }, [{ text: '1,200' }]), { values: [{ text: '1,200' }], list: false });
  });

  test('a template still applies, its questions answered, and the form\'s values take its keys\' place', () => {
    const team = typeOf('team');
    const template = '---\ntier: silver\nchannel: "#{ask:Channel?}"\n---\n# {title}\n\nTag: {tag}\n';
    let draft = startTypedNoteDraft(team, { title: 'Credit', tag: '#team/credit/emea' });
    draft = setDraftValues(draft, 'tier', [{ text: 'Gold' }]);
    draft = setDraftValues(draft, 'lead', [{ text: '@omar' }]);
    const plan = planTypedNote(team, draft, { template, now: new Date(now), answers: new Map([['Channel?', 'credit']]) });
    assert.strictEqual(
      plan?.content,
      '---\ndescribes: "#team/credit/emea"\ntier: Gold\nchannel: "#credit"\nlead: "@omar"\n---\n# Credit\n\nTag: #team/credit/emea\n',
    );
    const block = '---\ntier: |\n  silver\n---\n# {title}\n';
    const refused = planTypedNote(team, draft, { template: block, now: new Date(now) });
    assert.deepStrictEqual(refused?.unwritten, ['tier']);
    assert.match(refused?.content ?? '', /tier: \|\n {2}silver/);
  });

  test('a field\'s values are taken away when set to none', () => {
    const team = typeOf('team');
    const draft = setDraftValues(setDraftValues(startTypedNoteDraft(team), 'tier', [{ text: 'Gold' }]), 'tier', []);
    assert.deepStrictEqual(draft.values, {});
  });

  test('is checked for a title, a file and tag it can name, a hub note already there, and a note already there', () => {
    const team = typeOf('team');
    const start = startTypedNoteDraft(team);
    assert.deepStrictEqual(checkTypedNoteDraft(team, start), { row: 'title', message: 'A team needs a title.' });
    assert.strictEqual(checkTypedNoteDraft(team, { ...start, title: 'a/b' })?.row, 'title');
    assert.deepStrictEqual(checkTypedNoteDraft(team, { ...start, title: '!!!' }), {
      row: 'title',
      message: '"!!!" cannot name a tag. Choose Tag to write one.',
    });
    assert.strictEqual(checkTypedNoteDraft(team, { ...start, title: '!!!', tag: '#team/bang' }), undefined);
    assert.strictEqual(checkTypedNoteDraft(team, { ...start, title: 'X', folder: '../up' })?.row, 'folder');
    const hubOf = (tagKey: string): string | undefined => (tagKey === '#team/rates' ? 'Teams/Rates.md' : undefined);
    assert.deepStrictEqual(checkTypedNoteDraft(team, { ...start, title: 'Rates' }, { hubOf }), {
      row: 'tag',
      message: '#team/rates already has a hub note, Teams/Rates.md.',
    });
    assert.strictEqual(checkTypedNoteDraft(team, { ...startTypedNoteDraft(team, { title: 'Rates', tag: '#team/rates' }) }, { hubOf })?.row, 'title', 'a fixed tag is not the row to change');
    const exists = (path: string): boolean => path === 'Teams/Credit.md';
    assert.deepStrictEqual(checkTypedNoteDraft(team, { ...start, title: 'Credit' }, { exists }), {
      row: 'title',
      message: 'Teams/Credit.md already exists. Choose another title or folder.',
    });
    assert.strictEqual(checkTypedNoteDraft(team, { ...start, title: 'Credit', folder: 'Other' }, { exists }), undefined);
    const incident = typeOf('incident');
    assert.strictEqual(checkTypedNoteDraft(incident, { ...startTypedNoteDraft(incident), title: '!!!' }), undefined, 'a note type needs no tag');
  });

  test('typed text is read by kind, and checked as it is typed', () => {
    assert.deepStrictEqual(readFieldText(fieldOf('team', 'headcount').kind, ' 1,200 ', now), [{ text: '1,200' }]);
    assert.strictEqual(readFieldText(fieldOf('team', 'headcount').kind, 'many', now), undefined);
    assert.deepStrictEqual(readFieldText(fieldOf('person', 'start').kind, '2026-03-01', now), [{ text: '2026-03-01' }]);
    assert.match(readFieldText(fieldOf('person', 'start').kind, 'tomorrow', now)?.[0].text ?? '', /^2026-10-09$/);
    assert.deepStrictEqual(readFieldText({ name: 'note', many: false }, '[[RFQ outage]]', now), [{ text: '[[RFQ outage]]', title: 'RFQ outage' }]);
    assert.deepStrictEqual(readFieldText({ name: 'text', many: true }, 'a, b,, c', now), [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    assert.deepStrictEqual(readFieldText(fieldOf('team', 'tier').kind, 'GOLD', now), [{ text: 'gold' }]);
    assert.deepStrictEqual(readFieldText({ name: 'text', many: false }, '  ', now), []);

    assert.deepStrictEqual(checkFieldText(fieldOf('team', 'headcount'), 'ten', now), { message: 'headcount is a number, and "ten" is not one.', severity: 'error' });
    assert.strictEqual(checkFieldText(fieldOf('team', 'headcount'), '10', now), undefined);
    assert.strictEqual(checkFieldText(fieldOf('person', 'email'), 'dana', now)?.severity, 'error');
    assert.strictEqual(checkFieldText(fieldOf('person', 'email'), 'dana@example.com', now), undefined);
    assert.strictEqual(checkFieldText({ name: 'site', kind: { name: 'link', many: false } }, 'go/payments', now)?.severity, 'warning');
    assert.strictEqual(checkFieldText({ name: 'site', kind: { name: 'link', many: false } }, 'https://example.com', now), undefined);
    assert.strictEqual(checkFieldText({ name: 'phone', kind: { name: 'phone', many: false } }, '+1 (555) 010-2030', now), undefined);
    assert.strictEqual(checkFieldText({ name: 'phone', kind: { name: 'phone', many: false } }, 'ask Dana', now)?.severity, 'warning');
  });
});
