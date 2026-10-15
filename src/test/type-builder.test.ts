import * as assert from 'assert';

import type { TypeField } from '../domain/model';
import { parseFieldKind } from '../domain/types/fieldKinds';
import {
  checkFieldName,
  checkTypeName,
  createFieldMenuRows,
  createTypeFormRows,
  describeRows,
  findKindChoice,
  listKindChoices,
  listManyChoices,
  readCommaList,
  readSelectOptions,
  writeKindCell,
  type BuilderType,
} from '../ui/state/typeBuilder';

/** A schema field as the parser reads one from its Kind cell. */
function field(name: string, kindText: string, extra: Partial<TypeField> = {}): TypeField {
  return { name, key: name.toLowerCase().replace(/\s+/g, '-'), kindText, kind: parseFieldKind(kindText).kind, alsoCalled: [], line: 10, ...extra };
}

const ORG: BuilderType = {
  key: 'org',
  name: 'Org',
  filePath: 'Types/Org.md',
  rows: { kind: 'tags', prefix: '#org/', written: '#org/*' },
  fields: [
    field('lead', 'Person', { alsoCalled: ['owner'], line: 9 }),
    field('Distribution List', 'Person, many', { reverse: 'on distribution list for', line: 10 }),
    field('tier', 'Select: gold, silver', { line: 11 }),
  ],
};

const TYPES = [
  { key: 'person', name: 'Person', rows: { kind: 'tags', prefix: '@', written: '@*' } },
  { key: 'team', name: 'Team', rows: { kind: 'tags', prefix: '#team/', written: '#team/*' } },
  { key: 'area', name: 'Area', rows: { kind: 'tags', prefix: '#area/', written: '#area/*' } },
  { key: 'decision', name: 'Decision', rows: { kind: 'notes', written: 'notes' } },
] as const;

suite('Type builder: the form', () => {
  test('lists the fields with their kinds and what else is set, then Add field…, the type, and Done', () => {
    const rows = createTypeFormRows(ORG, { problems: [], rowCount: 14 });
    assert.deepStrictEqual(
      rows.map((row) => [row.label, row.description ?? '', row.detail ?? '']),
      [
        ['Fields', '', ''],
        ['lead', 'Person', 'Reverse: lead of · Also called: owner'],
        ['Distribution List', 'Person, many', 'Reverse: on distribution list for'],
        ['tier', 'Select: gold, silver', ''],
        ['Add field…', '', ''],
        ['Type', '', ''],
        ['Rows', 'Each #org/… tag · 14 orgs', ''],
        ['New notes go in', 'Orgs/', ''],
        ['Open Types/Org.md', '', ''],
        ['Done', '', ''],
      ],
    );
    assert.deepStrictEqual(rows[2].action, { kind: 'field', key: 'distribution-list' });
  });

  test('a field with a problem says it in place of what is set', () => {
    const problems = [{ code: 'unknown-kind' as const, message: 'No type is named Vendor.', filePath: 'Types/Org.md', line: -1, field: 'tier' }];
    const tier = createTypeFormRows(ORG, { problems, rowCount: 1 }).find((row) => row.label === 'tier');
    assert.strictEqual(tier?.detail, '$(warning) No type is named Vendor.');
    assert.strictEqual(tier?.icon, 'warning');
  });

  test('says what a type\'s rows are, and gives a note type no folder row', () => {
    assert.strictEqual(describeRows(ORG), 'Each #org/… tag');
    assert.strictEqual(describeRows({ key: 'person', rows: { kind: 'tags', prefix: '@', written: '@*' } }), 'Each person');
    const decision: BuilderType = { ...ORG, key: 'decision', name: 'Decision', rows: { kind: 'notes', written: 'notes' } };
    assert.strictEqual(describeRows(decision), 'Each note that says type: decision');
    assert.ok(!createTypeFormRows(decision, { problems: [], rowCount: 0 }).some((row) => row.label === 'New notes go in'));
  });

  test('a field\'s menu shows each value, the moves its place allows, and how many notes keep theirs on Remove', () => {
    const rows = createFieldMenuRows(ORG, ORG.fields[1], 3);
    assert.deepStrictEqual(
      rows.map((row) => [row.label, row.description ?? '']),
      [
        ['Rename…', 'rewrites the key in 3 notes'],
        ['Kind', 'Person'],
        ['Holds', 'several'],
        ['Reverse', 'on distribution list for'],
        ['Also called', 'not set'],
        ['Words', 'not set'],
        ['Order', ''],
        ['Move up', ''],
        ['Move down', ''],
        ['', ''],
        ['Remove from Org', '3 notes keep their values'],
      ],
    );
    const tier = createFieldMenuRows(ORG, ORG.fields[2], 0).map((row) => row.label);
    assert.ok(!tier.includes('Reverse') && !tier.includes('Move down') && tier.includes('Move up'), 'a select has no reverse; the last field cannot move down');
  });
});

suite('Type builder: kinds', () => {
  test('lists the kinds that name rows first, the people type as Person alone, then the values with Select… among them', () => {
    const rows = listKindChoices(TYPES);
    assert.deepStrictEqual(
      rows.map((row) => row.label),
      ['Rows', 'Person', 'Team', 'Area', 'Decision', 'More than one type…', 'Note', 'Values', 'Text', 'Number', 'Date', 'Select…', 'Checkbox', 'Link', 'Email', 'Phone'],
    );
    assert.strictEqual(rows.find((row) => row.label === 'Team')?.description, 'a Team row · "#team/…"');
    assert.strictEqual(rows.find((row) => row.label === 'Decision')?.description, 'a Decision note · "[[Title]]"');
  });

  test('finds the choice a Kind cell is, so the list opens on it', () => {
    const rows = listKindChoices(TYPES);
    assert.strictEqual(findKindChoice('Person, many', rows)?.label, 'Person');
    assert.strictEqual(findKindChoice('Select: a, b', rows)?.label, 'Select…');
    assert.strictEqual(findKindChoice('Team or Area', rows)?.label, 'More than one type…');
    assert.strictEqual(findKindChoice('team', rows)?.label, 'Team');
  });

  test('writes a Kind cell, and reads a select\'s options back', () => {
    assert.strictEqual(writeKindCell('Person', { many: true }), 'Person, many');
    assert.strictEqual(writeKindCell('', { selectOptions: [' gold', 'silver ', ''] }), 'Select: gold, silver');
    assert.deepStrictEqual(readSelectOptions('Select: gold, silver, many'), ['gold', 'silver']);
    assert.deepStrictEqual(readCommaList(' a, ,b '), ['a', 'b']);
  });

  test('one or many says how a row\'s front matter writes each', () => {
    assert.deepStrictEqual(
      listManyChoices('Distribution List', 'Person').map((row) => [row.label, row.description, row.detail, row.action]),
      [
        ['One person', 'Person', 'Distribution List: "@dana"', false],
        ['Several people', 'Person, many', 'Distribution List: ["@dana", "@omar"]', true],
      ],
    );
    assert.strictEqual(listManyChoices('tier', 'Select: gold, silver')[1].detail, 'tier: [gold, silver]');
  });
});

suite('Type builder: names', () => {
  test('a field\'s name says how it is written and searched, warns about a built-in, and refuses a bad or taken one', () => {
    assert.deepStrictEqual(checkFieldName('Mailing  List', ORG), { message: 'Written in front matter as Mailing List:, searched as mailing-list.' });
    assert.ok(checkFieldName('status', ORG).message?.startsWith('A search already reads status, so this field is searched as field.status.'));
    assert.deepStrictEqual(checkFieldName('cost ($)', ORG), { error: 'Start with a letter and use letters, digits, spaces, - and _.' });
    assert.deepStrictEqual(checkFieldName('distribution-list', ORG), { error: 'This type already has Distribution List.' });
    assert.ok(checkFieldName('Distribution List', ORG, 'distribution-list').message, 'its own name, when renaming');
  });

  test('a type\'s name says where it is written, and refuses one a type has or a file cannot', () => {
    assert.deepStrictEqual(checkTypeName('Vendor', TYPES), { message: 'Writes Types/Vendor.md. Its rows are searched as type = vendor.' });
    assert.deepStrictEqual(checkTypeName('team', TYPES), { error: 'There is a Team type already.' });
    assert.ok(checkTypeName('a/b', TYPES).error);
  });
});
