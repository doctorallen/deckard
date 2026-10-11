import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import { setFrontmatterField } from '../domain/types/frontmatterWriter';
import type { DrawnField } from '../ui/protocol/fields';
import { describeNoteFields, describeTagFields, planNoteFieldWrite, type FieldWritePlan } from '../ui/state/noteFields';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const index = typedWorkspace();

/** A field's name and its values' words, as the page draws them. */
const shown = (fields: readonly DrawnField[]): Array<[string, string[]]> => fields.map((field) => [field.name, field.values.map((value) => value.text)]);

/** A plan that writes, or a failure naming why it does not. */
function writes(plan: FieldWritePlan): Exclude<FieldWritePlan, { error: string }> {
  assert.ok(!('error' in plan), `planned no write: ${JSON.stringify(plan)}`);
  return plan as Exclude<FieldWritePlan, { error: string }>;
}

suite('Note page fields', () => {
  test('a typed row’s note lists its own filled fields in the schema’s order, then its other keys, then its reverses, its identity aside', () => {
    const fields = describeNoteFields(index, 'Teams/Rates.md', [
      { name: 'describes', values: [{ text: '#team/rates' }] },
      { name: 'lead', values: [{ text: '@dana' }] },
      { name: 'aliases', values: [{ text: 'FICC' }] },
    ]);
    assert.ok(fields);
    assert.strictEqual(fields.typeName, 'Team');
    assert.strictEqual(fields.typeQuery, 'type = team');
    assert.deepStrictEqual(shown(fields.fields), [
      ['lead', ['Dana Whitfield']],
      ['owns', ['Bond Trading', 'Fx']],
      ['tier', ['gold']],
      ['headcount', ['1,200']],
      ['on-call', ['Priya Natarajan']],
      ['status', ['active']],
      ['aliases', ['FICC']],
      ['members', ['Dana Whitfield']],
      ['team of', ['RFQ outage']],
    ]);
    assert.deepStrictEqual(fields.fields.map((field) => field.source === 'reverse'), [false, false, false, false, false, false, false, true, true], 'own fields, then reverses');
    assert.deepStrictEqual(fields.empty, []);
  });

  test('a person or relation value is its row’s title, opening its tag; a note row opens its note', () => {
    const fields = describeNoteFields(index, 'Teams/Rates.md', []);
    const lead = fields?.fields.find((field) => field.name === 'lead');
    assert.deepStrictEqual(lead?.values, [{ text: 'Dana Whitfield', tag: { key: '@dana', label: '@dana' } }]);
    const owns = fields?.fields.find((field) => field.name === 'owns');
    assert.deepStrictEqual(owns?.values.map((value) => value.tag?.key), ['#area/bond-trading', '#area/fx']);
    const dana = describeNoteFields(index, 'People/Dana Whitfield.md', []);
    const owner = dana?.fields.find((field) => field.name === 'owner of');
    assert.deepStrictEqual(owner?.values, [{ text: 'RFQ outage', filePath: 'Incidents/RFQ outage.md', reverse: true }]);
  });

  test('a reverse is drawn as one, and says where it is set: by the one row that sets it, or each row of its type', () => {
    const fields = describeNoteFields(index, 'Teams/Rates.md', []);
    const members = fields?.fields.find((field) => field.name === 'members');
    assert.strictEqual(members?.source, 'reverse');
    assert.strictEqual(members?.tip, "From each person's team");
    assert.deepStrictEqual(members?.from, [{ owner: "Dana Whitfield's", field: 'team' }], 'one person sets it');
    assert.strictEqual(fields?.fields.find((field) => field.name === 'lead')?.from, undefined, 'a field the note writes says nothing');
    assert.strictEqual(members?.edit, undefined, 'a reverse is written on the other rows');
    assert.ok(members?.values.every((value) => value.reverse));
    const dana = describeNoteFields(index, 'People/Dana Whitfield.md', []);
    assert.strictEqual(dana?.fields.find((field) => field.name === 'lead of')?.tip, "From each team's lead");
  });

  test('folds the schema’s empty fields apart, each still with its editor', () => {
    const credit = describeNoteFields(index, 'Teams/Credit.md', []);
    assert.deepStrictEqual(credit?.empty.map((field) => [field.name, field.edit?.input]), [['owns', 'rows'], ['on-call', 'rows'], ['status', 'text']]);
  });

  test('gives each field the note writes an editor by its kind, and lists each relation’s rows once', () => {
    const fields = describeNoteFields(index, 'Teams/Rates.md', []);
    const editors = Object.fromEntries((fields?.fields ?? []).map((field) => [field.name, field.edit]));
    assert.deepStrictEqual(editors.lead, { key: 'lead', many: false, input: 'rows', choices: 'people', current: ['@dana'] });
    assert.deepStrictEqual(editors.owns, { key: 'owns', many: true, input: 'rows', choices: 'rows:area', current: ['#area/bond-trading', '#area/fx'] });
    assert.deepStrictEqual(editors.tier, { key: 'tier', many: false, input: 'options', options: ['gold', 'silver', 'bronze'], current: ['gold'] });
    assert.deepStrictEqual(editors.headcount?.input, 'number');
    assert.deepStrictEqual(Object.keys(fields?.choices ?? {}).sort(), ['people', 'rows:area']);
    assert.deepStrictEqual(fields?.choices?.people.map((choice) => [choice.id, choice.title, choice.detail]), [
      ['@dana', 'Dana Whitfield', 'Person · team Rates'],
      ['@omar', 'Omar Haddad', 'Person · team Credit'],
      ['@priya', 'Priya Natarajan', 'Person'],
    ]);
    const dana = describeNoteFields(index, 'People/Dana Whitfield.md', []);
    const kinds = Object.fromEntries((dana?.fields ?? []).map((field) => [field.name, field.edit && [field.edit.input, field.edit.current]]));
    assert.deepStrictEqual(kinds.start, ['date', ['2026-03-01']]);
    assert.deepStrictEqual(kinds.remote, ['checkbox', ['true']]);
    assert.deepStrictEqual(kinds.email, ['text', ['dana@example.com']]);
  });

  test('a note row is drawn as its type’s, and a note no type has has no fields', () => {
    const outage = describeNoteFields(index, 'Incidents/RFQ outage.md', [{ name: 'type', values: [{ text: 'incident' }] }]);
    assert.strictEqual(outage?.typeQuery, 'type = incident');
    assert.deepStrictEqual(shown(outage?.fields ?? []), [['owner', ['Dana Whitfield']], ['team', ['Rates']], ['severity', ['sev1']]]);
    assert.strictEqual(describeNoteFields(index, 'notes/plain.md', []), undefined);
  });

  test('the Note page carries a typed note’s fields, and labels its hub line with the type, which opens its rows', () => {
    const options = { queryContext: createQueryContext(now), history: { back: false, forward: false }, visit: 1 };
    const rates = createNotePageSnapshot(index, 'Teams/Rates.md', options);
    assert.strictEqual(rates.fields?.typeName, 'Team');
    assert.deepStrictEqual([rates.hub?.kind, rates.hub?.typeQuery], ['Team', 'type = team']);
    assert.ok(rates.properties.length > 0, 'the properties stay for what reads them');
    assert.ok(!rates.fields?.fields.some((field) => field.name === 'describes'));
    const plain = createNotePageSnapshot(index, 'notes/plain.md', options);
    assert.strictEqual(plain.fields, undefined);
  });
});

suite('Tag page fields', () => {
  test('a typed row with a hub note draws the hub’s fields, each it writes with its editor, as the Note page does', () => {
    const fields = describeTagFields(index, '#team/rates');
    assert.deepStrictEqual(fields?.fields.map((field) => field.name).slice(0, 2), ['lead', 'owns']);
    assert.deepStrictEqual(fields?.fields.find((field) => field.name === 'lead')?.edit, { key: 'lead', many: false, input: 'rows', choices: 'people', current: ['@dana'] });
    assert.strictEqual(fields?.fields.find((field) => field.name === 'members')?.edit, undefined, 'a reverse is written on the other rows');
    assert.deepStrictEqual(Object.keys(fields?.choices ?? {}).sort(), ['people', 'rows:area']);
    const credit = describeTagFields(index, '#team/credit');
    assert.deepStrictEqual(credit?.empty.map((field) => field.edit?.key), ['owns', 'on-call', 'status'], 'its empty fields, to fold and add');
  });

  test('a typed row with no note lists its type’s fields as Not set, each starting its note, then its reverses with who owns what they name', () => {
    const fields = describeTagFields(index, '#area/bond-trading');
    assert.deepStrictEqual(fields?.fields.map((field) => [field.name, field.source, field.startsNote, field.values.map((value) => [value.text, value.detail])]), [
      ['system', 'written', 'system', []],
      ['owned by', 'reverse', undefined, [['Rates', 'lead Dana Whitfield · on-call Priya Natarajan']]],
    ]);
    assert.deepStrictEqual(fields?.fields[1].from, [{ owner: "Rates'", field: 'owns' }]);
    assert.deepStrictEqual(fields?.empty, [], 'nothing folds: every field of its own reads Not set');
    assert.strictEqual(describeTagFields(index, '#project/none'), undefined);
  });
});

suite('Tag page fields for a row with no note', () => {
  const work = indexOf({
    'Types/Person.md': '---\ndeckard-type: person\nrows: "@*"\n---\n# Person\n\n| Field | Kind | Reverse |\n| --- | --- | --- |\n| role | Text | |\n| manager | Person | reports |\n',
    'Types/Team.md': '---\ndeckard-type: team\nrows: "#team/*"\n---\n# Team\n\n| Field | Kind |\n| --- | --- |\n| lead | Person |\n| on-call | Person |\n',
    'Types/Decision.md': '---\ndeckard-type: decision\nrows: notes\n---\n# Decision\n\n| Field | Kind | Reverse |\n| --- | --- | --- |\n| decided-by | Person, many | decided |\n',
    'Types/Badge.md': '---\ndeckard-type: badge\nrows: "#badge/*"\n---\n# Badge\n\nNo fields yet.\n',
    'teams/Payments.md': '---\ndescribes: "#team/payments"\nlead: "@alex"\non-call: "@sam"\n---\n# Payments',
    'people/Theo.md': '---\ndescribes: "@theo"\nmanager: "@alex"\n---\n# Theo',
    'people/Noor.md': '---\ndescribes: "@noor"\nmanager: "@alex"\n---\n# Noor',
    'decisions/ADR-1.md': '---\ntype: decision\ndecided-by: ["@alex", "@theo"]\n---\n# ADR-1',
    'decisions/ADR-2.md': '---\ntype: decision\ndecided-by: ["@alex"]\n---\n# ADR-2',
    'notes/log.md': '# Log @alex @sam #badge/gold #badge/silver\n',
    'notes/gold.md': '# Gold\n#badge/gold',
  });
  const alex = describeTagFields(work, '@alex');
  const field = (name: string) => alex?.fields.find((each) => each.name === name);

  test('its own fields lead, Not set, and the reverses follow', () => {
    assert.deepStrictEqual(alex?.fields.map((each) => [each.name, each.source, each.startsNote]), [
      ['role', 'written', 'role'],
      ['manager', 'written', 'manager'],
      ['lead of', 'reverse', undefined],
      ['reports', 'reverse', undefined],
      ['decided', 'reverse', undefined],
    ]);
  });

  test('a reverse says where it is set: the one row by its title, several by their type', () => {
    assert.deepStrictEqual(field('lead of')?.from, [{ owner: "Payments'", field: 'lead' }]);
    assert.deepStrictEqual(field('reports')?.from, [{ owner: "each person's", field: 'manager' }]);
    assert.deepStrictEqual(field('decided')?.from, [{ owner: "each decision's", field: 'decided-by' }]);
  });

  test('a value’s details leave out the row shown: a fact naming only it goes, and one naming others keeps them', () => {
    assert.deepStrictEqual(field('lead of')?.values.map((value) => value.detail), ['on-call Sam'], 'its lead is the row shown');
    assert.deepStrictEqual(field('reports')?.values.map((value) => value.detail), [undefined, undefined], 'nothing left to say');
    assert.deepStrictEqual(field('decided')?.values.map((value) => [value.text, value.detail]), [['ADR-1', 'also decided-by Theo'], ['ADR-2', undefined]]);
  });

  test('a type with no fields lists no Not set rows, and a row nothing names then has no card', () => {
    assert.strictEqual(describeTagFields(work, '#badge/silver'), undefined);
  });
});

suite('Note page field edits', () => {
  const rates = index.files.get('Teams/Rates.md')?.content ?? '';
  const dana = index.files.get('People/Dana Whitfield.md')?.content ?? '';
  const plan = (filePath: string, key: string, value: Parameters<typeof planNoteFieldWrite>[1]['value']) => planNoteFieldWrite(index, { filePath, key, value }, now);
  const lineOf = (content: string, key: string, planned: FieldWritePlan): string | undefined => {
    const write = writes(planned);
    const edit = setFrontmatterField(content, write.key, write.write);
    return edit.kind === 'edit' ? edit.content.split('\n').find((line) => line.startsWith(`${key}:`)) : edit.kind;
  };

  test('a row chosen for a field that holds one replaces it, in its tag form', () => {
    const planned = writes(plan('Teams/Rates.md', 'lead', { kind: 'row', rowId: '@omar' }));
    assert.deepStrictEqual(planned.write, { values: [{ text: '@omar' }], list: false });
    assert.strictEqual(planned.label, 'Set lead to Omar Haddad in "Rates"');
    assert.strictEqual(lineOf(rates, 'lead', planned), 'lead: "@omar"');
  });

  test('a row chosen for a field that holds several is added, or taken away when it is there, the rest kept as written', () => {
    assert.strictEqual(lineOf(rates, 'owns', plan('Teams/Rates.md', 'owns', { kind: 'row', rowId: '#area/fx' })), 'owns: [bond trading]');
    const credit = index.files.get('Teams/Credit.md')?.content ?? '';
    assert.strictEqual(lineOf(credit, 'owns', plan('Teams/Credit.md', 'owns', { kind: 'row', rowId: '#area/fx' })), 'owns: ["#area/fx"]');
  });

  test('an option is written as the schema spells it; a number bare; a date as a day; a box as true or false', () => {
    assert.strictEqual(lineOf(rates, 'tier', plan('Teams/Rates.md', 'tier', { kind: 'option', option: 'SILVER' })), 'tier: silver');
    assert.strictEqual(lineOf(rates, 'headcount', plan('Teams/Rates.md', 'headcount', { kind: 'text', text: '12' })), 'headcount: 12');
    assert.strictEqual(lineOf(dana, 'start', plan('People/Dana Whitfield.md', 'start', { kind: 'text', text: '2026-04-01' })), 'start: 2026-04-01');
    assert.strictEqual(lineOf(dana, 'remote', plan('People/Dana Whitfield.md', 'remote', { kind: 'checkbox', checked: false })), 'remote: false');
  });

  test('refuses what the field cannot hold, and a note that is no row', () => {
    const errors = [
      plan('Teams/Rates.md', 'lead', { kind: 'row', rowId: '#team/credit' }),
      plan('Teams/Rates.md', 'tier', { kind: 'option', option: 'platinum' }),
      plan('Teams/Rates.md', 'headcount', { kind: 'text', text: 'many' }),
      plan('People/Dana Whitfield.md', 'start', { kind: 'text', text: 'someday soon' }),
      plan('Teams/Rates.md', 'lead', { kind: 'text', text: 'Omar' }),
      plan('Teams/Rates.md', 'describes', { kind: 'text', text: '#team/credit' }),
      plan('notes/plain.md', 'lead', { kind: 'row', rowId: '@dana' }),
    ];
    assert.ok(errors.every((each) => 'error' in each), JSON.stringify(errors));
  });

  test('clears a field, and writes a free key Other… names', () => {
    assert.strictEqual(lineOf(rates, 'status', plan('Teams/Rates.md', 'status', { kind: 'clear' })), undefined);
    const other = writes(plan('Teams/Rates.md', 'pager', { kind: 'text', text: 'rates-oncall' }));
    assert.deepStrictEqual([other.key, other.write], ['pager', { values: [{ text: 'rates-oncall' }] }]);
    assert.strictEqual(lineOf(rates, 'pager', other), 'pager: rates-oncall');
  });
});
