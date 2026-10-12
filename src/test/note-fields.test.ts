import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import type { DrawnField } from '../ui/protocol/fields';
import { describeNoteFields, describeTagFields } from '../ui/state/noteFields';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const index = typedWorkspace();

/** A field's name and its values' words, as the page draws them. */
const shown = (fields: readonly DrawnField[]): Array<[string, string[]]> => fields.map((field) => [field.name, field.values.map((value) => value.text)]);

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
    assert.strictEqual(members?.key, undefined, 'a reverse is written on the other rows, so its name opens nothing');
    assert.ok(members?.values.every((value) => value.reverse));
    const dana = describeNoteFields(index, 'People/Dana Whitfield.md', []);
    assert.strictEqual(dana?.fields.find((field) => field.name === 'lead of')?.tip, "From each team's lead");
  });

  test('gives each schema field the note writes its key, for its name to open the form on, and leaves out the empty ones', () => {
    const fields = describeNoteFields(index, 'Teams/Rates.md', [{ name: 'aliases', values: [{ text: 'FICC' }] }]);
    assert.deepStrictEqual(fields?.fields.map((field) => [field.name, field.key]), [
      ['lead', 'lead'],
      ['owns', 'owns'],
      ['tier', 'tier'],
      ['headcount', 'headcount'],
      ['on-call', 'on-call'],
      ['status', 'status'],
      ['aliases', undefined],
      ['members', undefined],
      ['team of', undefined],
    ]);
    const credit = describeNoteFields(index, 'Teams/Credit.md', []);
    assert.deepStrictEqual(credit?.fields.map((field) => field.name), ['lead', 'tier', 'headcount', 'members', 'team of'], 'the empty fields are the form’s to list');
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
  test('a typed row with a hub note draws the hub’s fields, each with its key, as the Note page does', () => {
    const fields = describeTagFields(index, '#team/rates');
    assert.deepStrictEqual(fields?.fields.map((field) => field.name).slice(0, 2), ['lead', 'owns']);
    assert.strictEqual(fields?.fields.find((field) => field.name === 'lead')?.key, 'lead');
    assert.strictEqual(fields?.fields.find((field) => field.name === 'members')?.key, undefined, 'a reverse is written on the other rows');
  });

  test('a typed row with no note lists only its reverses, with who owns what they name; its own fields are the form’s', () => {
    const fields = describeTagFields(index, '#area/bond-trading');
    assert.deepStrictEqual(fields?.fields.map((field) => [field.name, field.source, field.key, field.values.map((value) => [value.text, value.detail])]), [
      ['owned by', 'reverse', undefined, [['Rates', 'lead Dana Whitfield · on-call Priya Natarajan']]],
    ]);
    assert.deepStrictEqual(fields?.fields[0].from, [{ owner: "Rates'", field: 'owns' }]);
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

  test('its reverses alone are listed, none of them with a key', () => {
    assert.deepStrictEqual(alex?.fields.map((each) => [each.name, each.source, each.key]), [
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

  test('a row whose type has fields has a card for Add fields…, though nothing names it; one with neither has none', () => {
    const lone = indexOf({
      'Types/Person.md': '---\ndeckard-type: person\nrows: "@*"\n---\n# Person\n\n| Field | Kind |\n| --- | --- |\n| role | Text |\n',
      'notes/log.md': '# Log @lee\n',
    });
    assert.deepStrictEqual(describeTagFields(lone, '@lee')?.fields, [], 'a card with no rows, for Add fields…');
    assert.strictEqual(describeTagFields(work, '#badge/silver'), undefined);
  });
});
