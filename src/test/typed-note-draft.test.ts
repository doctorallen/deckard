import * as assert from 'assert';

import { getTypeIndex } from '../domain/types/typeIndex';
import {
  checkFieldText,
  checkTypedNoteDraft,
  draftNotePath,
  draftTagOf,
  findRefusedFields,
  listChangedFields,
  listDraftFields,
  planFieldSave,
  planTypedNote,
  readDraftFolder,
  readDraftTag,
  readFieldText,
  readFrontmatterBlock,
  setDraftValues,
  startExistingNoteDraft,
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

  test('starts with the values and the words it is given, as a term note from a term\'s hover', () => {
    const term: DraftType = {
      key: 'term',
      name: 'Term',
      rows: { kind: 'notes', written: 'notes' },
      fields: [{ key: 'term', name: 'term', kind: { name: 'text', many: false } }],
    };
    const draft = startTypedNoteDraft(term, { title: 'NDF', values: { term: 'NDF', type: 'other', nothing: 'x' }, body: ' A non-deliverable forward. ' });
    assert.deepStrictEqual(draft.values, { term: [{ text: 'NDF' }] }, 'only a field the type has, not its identity');
    assert.strictEqual(
      planTypedNote(term, draft, { now: new Date(now) })?.content,
      '---\ntype: term\nterm: NDF\n---\n# NDF\n\nA non-deliverable forward.\n',
    );
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

suite('Editing a note of a type that exists', () => {
  const rates = [
    '---',
    'describes: "#team/rates"',
    'lead: "@dana" # the head of desk',
    'owns: [bond trading, "#area/fx"]',
    'tier: Gold',
    '---',
    '# Rates',
    'Body.',
  ].join('\n');
  const values = {
    lead: [{ text: '@dana', title: 'Dana Whitfield' }],
    owns: [{ text: '#area/bond-trading', title: 'Bond Trading' }, { text: '#area/fx', title: 'Fx' }],
    tier: [{ text: 'gold' }],
    headcount: [],
  };
  const edit = () => startExistingNoteDraft(typeOf('team'), { filePath: 'Teams/Rates.md', title: 'Rates', content: rates, values });

  test('starts from the note as read: its title, its folder, its values, and its front matter', () => {
    const draft = edit();
    assert.strictEqual(draft.title, 'Rates');
    assert.strictEqual(draft.folder, 'Teams');
    assert.deepStrictEqual(Object.keys(draft.values), ['lead', 'owns', 'tier'], 'a field with no values is not set');
    assert.deepStrictEqual(draft.existing?.original, draft.values);
    assert.deepStrictEqual(draft.existing?.refused, {});
    assert.strictEqual(draft.existing?.frontmatter, rates.split('\n').slice(0, 6).join('\n'));
    assert.strictEqual(readFrontmatterBlock('# No front matter'), '');
    assert.strictEqual(readFrontmatterBlock('---\r\na: 1\r\n---\r\nBody'), '---\na: 1\n---');
  });

  test('lists only the fields changed since, and saving nothing changed writes nothing', () => {
    const team = typeOf('team');
    const draft = edit();
    assert.deepStrictEqual(listChangedFields(team, draft), []);
    assert.deepStrictEqual(planFieldSave(team, draft, rates), { kind: 'unchanged' });
    const same = setDraftValues(draft, 'tier', [{ text: 'gold' }]);
    assert.deepStrictEqual(listChangedFields(team, same), [], 'the same value again is no change');
    const changed = setDraftValues(setDraftValues(draft, 'tier', [{ text: 'silver' }]), 'headcount', [{ text: '12' }]);
    assert.deepStrictEqual(listChangedFields(team, changed).map((field) => field.key), ['tier', 'headcount']);
    assert.deepStrictEqual(listChangedFields(team, startTypedNoteDraft(team)), [], 'a new note has nothing to compare');
  });

  test('saving writes only the changed keys, as one run of lines, every other key and comment as written', () => {
    const team = typeOf('team');
    let draft = setDraftValues(edit(), 'tier', [{ text: 'silver' }]);
    draft = setDraftValues(draft, 'headcount', [{ text: '12' }]);
    draft = setDraftValues(draft, 'lead', [{ text: '@omar', title: 'Omar Haddad' }]);
    const plan = planFieldSave(team, draft, rates);
    assert.strictEqual(plan.kind, 'edit');
    assert.strictEqual(plan.content, [
      '---',
      'describes: "#team/rates"',
      'lead: "@omar" # the head of desk',
      'owns: [bond trading, "#area/fx"]',
      'tier: silver',
      'headcount: 12',
      '---',
      '# Rates',
      'Body.',
    ].join('\n'));
    assert.deepStrictEqual([plan.start, plan.deleted, plan.lines], [2, 3, ['lead: "@omar" # the head of desk', 'owns: [bond trading, "#area/fx"]', 'tier: silver', 'headcount: 12']]);
    assert.deepStrictEqual(plan.changed, ['lead', 'tier', 'headcount']);
    const cleared = planFieldSave(team, setDraftValues(edit(), 'owns', []), rates);
    assert.strictEqual(cleared.kind === 'edit' && cleared.content.includes('owns'), false, 'a field emptied is taken out');
    assert.deepStrictEqual(cleared.kind === 'edit' ? [cleared.start, cleared.deleted, cleared.lines] : undefined, [3, 1, []]);
  });

  test('a note whose front matter changed since it was read is stale, and a change to its body is not', () => {
    const team = typeOf('team');
    const draft = setDraftValues(edit(), 'tier', [{ text: 'silver' }]);
    assert.deepStrictEqual(planFieldSave(team, draft, rates.replace('tier: Gold', 'tier: Bronze')), { kind: 'stale' });
    const plan = planFieldSave(team, draft, rates.replace('Body.', 'Body, edited.'));
    assert.strictEqual(plan.kind === 'edit' && plan.content.endsWith('Body, edited.'), true);
  });

  test('a field written as a block, or as keys of its own, is refused, with the line to open the editor at', () => {
    const team = typeOf('team');
    const content = ['---', 'describes: "#team/rates"', 'status: |', '  Fine.', 'owns:', '  rates: yes', '---', '# Rates'].join('\n');
    assert.deepStrictEqual(findRefusedFields(team, content), { owns: 6, status: 3 });
    const draft = setDraftValues(
      startExistingNoteDraft(team, { filePath: 'Teams/Rates.md', title: 'Rates', content, values: { status: [{ text: 'Fine.' }] } }),
      'status',
      [{ text: 'Done.' }],
    );
    assert.deepStrictEqual(planFieldSave(team, draft, content), { kind: 'refused', key: 'status', name: 'status', line: 3 });
  });
});
