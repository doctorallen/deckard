import * as assert from 'assert';

import { normalizePreferences } from '../core/storage/preferencesSchema';
import { createQueryContext } from '../domain/query/queryContext';
import { renameFrontmatterKey, type FrontmatterFieldEdit } from '../domain/types/frontmatterWriter';
import { planFieldRename, planOptionRename, renameKindOption, rewriteTableCell } from '../domain/types/typeRenames';
import type { TypeTableView } from '../domain/model';
import type { SearchPageTypeRows } from '../ui/protocol/searchPage';
import { buildHubTree } from '../ui/state/hubTree';
import { createQueryBlockSnapshot, describeNoteCell, parseQueryBlockInfo } from '../ui/state/queryBlockState';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences } from './preferenceServices';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const lines = (...text: string[]): string => text.join('\n');
const queryContext = createQueryContext(now);

/** The reader's preferences as a fresh store holds them, with `extra` over them. */
function preferences(extra: Record<string, unknown> = {}) {
  const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
  try {
    return { ...store.reader.value, ...extra } as never;
  } finally {
    store.repository.dispose();
  }
}

/** A search page's rows tab for a search, with a type's view chosen. */
function rowsTab(query: string, view?: TypeTableView, index = typedWorkspace()): SearchPageTypeRows {
  const typeKey = /type = (\w+)/.exec(query)?.[1] ?? '';
  const snapshot = createSearchPageSnapshot(index, preferences(view ? { typeTables: { [typeKey]: view } } : {}), query, { queryContext });
  assert.ok(snapshot.typeRows, `${query} has a rows tab`);
  return snapshot.typeRows;
}

/** Each row's cells as text, the title's first. */
function cells(table: SearchPageTypeRows): string[][] {
  return table.rows.map((row) => row.cells.map((cell) => cell.text));
}

/** The note after an edit, or a failure naming what it came to instead. */
function written(edit: FrontmatterFieldEdit): string {
  assert.strictEqual(edit.kind, 'edit', `wrote nothing: ${JSON.stringify(edit)}`);
  return edit.kind === 'edit' ? edit.content : '';
}

suite('Types as searches: the rows tab', () => {
  test('titles a type’s search with its plural name and its rows', () => {
    const teams = createSearchPageSnapshot(typedWorkspace(), preferences(), 'type = team', { queryContext });
    assert.deepStrictEqual([teams.typeRows?.plural, teams.typeRows?.rule, teams.typeRows?.filePath], ['Teams', '#team/*', 'Types/Team.md']);
    assert.deepStrictEqual([rowsTab('type = incident').plural, rowsTab('type = incident').rule], ['Incidents', 'type: incident · Incidents/']);
    assert.strictEqual(createSearchPageSnapshot(typedWorkspace(), preferences(), '#team/rates', { queryContext }).typeRows, undefined, 'a tag is no type');
  });

  test('shows every schema field, then Open tasks and Last mentioned, and offers the reverses and the rest', () => {
    const table = rowsTab('type = team');
    assert.deepStrictEqual(table.columns.map((column) => [column.id, column.label, column.source]), [
      ['title', 'Team', 'title'],
      ['lead', 'lead', 'field'],
      ['owns', 'owns', 'field'],
      ['tier', 'tier', 'field'],
      ['headcount', 'headcount', 'field'],
      ['on-call', 'on-call', 'field'],
      ['status', 'status', 'field'],
      ['open-tasks', 'Open tasks', 'computed'],
      ['last-mentioned', 'Last mentioned', 'computed'],
    ]);
    assert.deepStrictEqual(table.available.filter((column) => !table.columns.includes(column)).map((column) => column.label), ['Members', 'Team of', 'Mentions']);
    assert.strictEqual(table.columns.find((column) => column.id === 'tier')?.select, true);
  });

  test('draws people and relations as links by title, several joined, dates in words and in full, and open tasks with what is overdue', () => {
    const table = rowsTab('type = team');
    assert.deepStrictEqual(cells(table), [
      ['Credit', 'Omar Haddad', '', 'silver', '8', '', '', '0', 'today · 2026-10-08'],
      ['Rates', 'Dana Whitfield', 'Bond Trading, Fx', 'gold', '1,200', 'Priya Natarajan', 'active', '2 · 1 overdue', 'today · 2026-10-08'],
    ]);
    const rates = table.rows[1];
    assert.deepStrictEqual(rates.cells[2].values, [
      { text: 'Bond Trading', tag: { key: '#area/bond-trading', label: '#area/bond-trading' } },
      { text: 'Fx', tag: { key: '#area/fx', label: '#area/fx' } },
    ]);
    assert.deepStrictEqual(rates.cells[3].values, [{ text: 'gold', option: 'gold' }], 'an option as the schema spells it, for its rename');
    assert.strictEqual(rates.cells[7].overdue, 1);
    assert.deepStrictEqual([rates.tag?.key, rates.filePath], ['#team/rates', 'Teams/Rates.md']);
  });

  test('says a namespace row has no hub note, with how many entries carry its tag', () => {
    const table = rowsTab('type = area');
    const bond = table.rows.find((row) => row.id === '#area/bond-trading');
    assert.deepStrictEqual(bond?.noHub, { entries: 1 });
    assert.strictEqual(bond?.filePath, undefined);
  });

  test('a row’s ⋯ copies its first email', () => {
    const people = rowsTab('type = person');
    assert.deepStrictEqual(people.rows.find((row) => row.id === '@dana')?.copy, { label: 'email', value: 'dana@example.com' });
    assert.strictEqual(people.rows.find((row) => row.id === '@priya')?.copy, undefined);
    assert.deepStrictEqual(people.rows.find((row) => row.id === '@dana')?.cells[3].text, '2026-03-01', 'a date past a month is the full date alone');
  });

  test('sorts by a column either way, a row with nothing in it last, and by title otherwise', () => {
    const titles = (table: SearchPageTypeRows): string[] => table.rows.map((row) => row.title);
    assert.deepStrictEqual(titles(rowsTab('type = team')), ['Credit', 'Rates']);
    assert.deepStrictEqual(titles(rowsTab('type = team', { sort: { column: 'headcount', direction: 'desc' } })), ['Rates', 'Credit'], 'numbers by number');
    assert.deepStrictEqual(titles(rowsTab('type = person', { sort: { column: 'team', direction: 'asc' } })), ['Omar Haddad', 'Dana Whitfield', 'Priya Natarajan']);
    assert.deepStrictEqual(titles(rowsTab('type = person', { sort: { column: 'team', direction: 'desc' } })), ['Dana Whitfield', 'Omar Haddad', 'Priya Natarajan'], 'the empty one stays last');
    assert.deepStrictEqual(rowsTab('type = team', { sort: { column: 'gone', direction: 'asc' } }).sort, undefined, 'a sort by a column not shown is dropped');
  });

  test('shows the columns the reader chose, the title first', () => {
    const table = rowsTab('type = team', { columns: ['members', 'lead', 'nothing'] });
    assert.deepStrictEqual(table.columns.map((column) => column.id), ['title', 'members', 'lead']);
    assert.deepStrictEqual(cells(table), [['Credit', 'Omar Haddad', 'Omar Haddad'], ['Rates', 'Dana Whitfield', 'Dana Whitfield']]);
  });

  test('groups by a field, a row in two groups in both and the rows with none last, by the select’s order', () => {
    const owns = rowsTab('type = team', { groupBy: 'owns' });
    assert.deepStrictEqual(owns.rows, []);
    assert.deepStrictEqual(owns.groups?.map((group) => [group.label, group.rows.map((row) => row.title)]), [
      ['Bond Trading', ['Rates']],
      ['Fx', ['Rates']],
      ['No owns', ['Credit']],
    ]);
    assert.deepStrictEqual(rowsTab('type = team', { groupBy: 'tier' }).groups?.map((group) => group.label), ['gold', 'silver']);
    assert.deepStrictEqual(rowsTab('type = team').groupFields.map((field) => field.id), ['lead', 'owns', 'tier', 'on-call']);
    assert.strictEqual(rowsTab('type = team', { groupBy: 'status' }).groups, undefined, 'a text field groups nothing');
  });

  test('lists a reverse’s people by first name, three of them, then how many more', () => {
    const index = indexOf({
      'Types/Person.md': lines('---', 'deckard-type: person', 'rows: "@*"', '---', '# Person', '', '| Field | Kind | Reverse |', '| --- | --- | --- |', '| team | Team | members |'),
      'Types/Team.md': lines('---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '', '| Field | Kind |', '| --- | --- |', '| lead | Person |'),
      'notes/rates.md': '# Rates #team/rates',
      ...Object.fromEntries(['Dana Whitfield', 'Sam Ortiz', 'Lena Park', 'Omar Haddad', 'Priya'].map((name) => [
        `People/${name}.md`,
        lines('---', `describes: "@${name.split(' ')[0].toLowerCase()}"`, 'team: rates', '---', `# ${name}`),
      ])),
    });
    const table = rowsTab('type = team', { columns: ['members'] }, index);
    const members = table.rows[0].cells[1];
    assert.deepStrictEqual(members.values?.map((value) => value.text), ['Dana', 'Sam', 'Lena']);
    assert.strictEqual(members.more, 2);
    assert.strictEqual(members.text, 'Dana Whitfield, Sam Ortiz, Lena Park, Omar Haddad, Priya', 'the whole list, for its tip');
  });

  test('Refine counts a type’s select fields over the rows the search finds', () => {
    const snapshot = createSearchPageSnapshot(typedWorkspace(), preferences(), 'type = team', { queryContext });
    assert.deepStrictEqual(snapshot.query.facets.find((facet) => facet.id === 'field:tier'), {
      id: 'field:tier',
      label: 'tier',
      values: [{ label: 'gold', clause: 'tier = gold', count: 1 }, { label: 'silver', clause: 'tier = silver', count: 1 }],
      applied: [],
    });
    const narrowed = createSearchPageSnapshot(typedWorkspace(), preferences(), 'type = team tier = gold', { queryContext });
    assert.strictEqual(narrowed.typeRows?.count, 1);
    assert.strictEqual(narrowed.query.facets.some((facet) => facet.id === 'field:tier'), false, 'nothing left to narrow by');
  });

  test('a tag’s page whose namespace has no type offers to make one', () => {
    const index = indexOf({
      'Types/Team.md': lines('---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team'),
      'notes/a.md': '# A #project/atlas',
      'notes/b.md': '# B #team/rates',
    });
    assert.strictEqual(createSearchPageSnapshot(index, preferences(), '#project/atlas', { queryContext }).untypedNamespace, 'project');
    assert.strictEqual(createSearchPageSnapshot(index, preferences(), '#team/rates', { queryContext }).untypedNamespace, undefined);
  });

  test('keeps each type’s view as stored, only what is usable', () => {
    assert.deepStrictEqual(
      normalizePreferences({ typeTables: { team: { columns: ['lead', 'lead', 7], sort: { column: 'lead', direction: 'up' }, groupBy: 'tier' }, '': {}, person: {} } } as never).typeTables,
      { team: { columns: ['title', 'lead'], sort: { column: 'lead', direction: 'asc' }, groupBy: 'tier' } },
    );
    assert.strictEqual(normalizePreferences({ typeTables: 'no' } as never).typeTables, undefined);
  });
});

suite('Types as searches: renames', () => {
  const NOTE = lines('---', 'describes: "#team/rates"', 'Lead :  "@dana"   # since March', 'owns:', '  - fx', '---', '# Rates');

  test('renames a front-matter key, keeping its value, comment, spacing, and the lines under it', () => {
    assert.strictEqual(
      written(renameFrontmatterKey(NOTE, 'lead', 'manager')),
      lines('---', 'describes: "#team/rates"', 'manager :  "@dana"   # since March', 'owns:', '  - fx', '---', '# Rates'),
    );
    assert.strictEqual(written(renameFrontmatterKey(NOTE, 'OWNS', 'areas')), NOTE.replace('owns:', 'areas:'));
    assert.strictEqual(written(renameFrontmatterKey(NOTE.replace(/\n/g, '\r\n'), 'lead', 'head')).includes('\r\nhead :'), true, 'line endings kept');
  });

  test('says nothing changed, or why not', () => {
    assert.deepStrictEqual(renameFrontmatterKey(NOTE, 'tier', 'level'), { kind: 'unchanged' });
    assert.deepStrictEqual(renameFrontmatterKey('# No front matter', 'lead', 'head'), { kind: 'unchanged' });
    assert.deepStrictEqual(renameFrontmatterKey(NOTE, 'lead', 'owns'), { kind: 'refused', reason: 'key-taken', line: 4 });
    assert.deepStrictEqual(renameFrontmatterKey(NOTE, 'lead', '2nd'), { kind: 'refused', reason: 'bad-key', line: 1 });
    assert.strictEqual(written(renameFrontmatterKey(NOTE, 'lead', 'LEAD')).includes('LEAD :'), true, 'a change of case is a rename');
  });

  test('renames every line that writes the key', () => {
    assert.strictEqual(written(renameFrontmatterKey(lines('---', 'a: 1', 'b: 2', 'a: 3', '---'), 'a', 'c')), lines('---', 'c: 1', 'b: 2', 'c: 3', '---'));
  });

  test('plans renaming a field in every row note that writes it, and in the schema table', () => {
    const plan = planFieldRename(typedWorkspace(), 'team', 'lead', 'manager');
    assert.ok(!('error' in plan));
    assert.deepStrictEqual([...plan.notes].sort(), ['Teams/Credit.md', 'Teams/Rates.md']);
    assert.deepStrictEqual(plan.schema, { filePath: 'Types/Team.md', line: 9, cell: 0, text: 'manager' });
    assert.deepStrictEqual(planFieldRename(typedWorkspace(), 'team', 'lead', 'owns'), { error: 'Team already has a field called owns.' });
    assert.ok('error' in planFieldRename(typedWorkspace(), 'team', 'lead', 'two words'));
    assert.ok('error' in planFieldRename(typedWorkspace(), 'team', 'nothing', 'x'));
  });

  test('plans renaming an option where it is held, and in the Kind cell', () => {
    const plan = planOptionRename(typedWorkspace(), { typeKey: 'team', field: 'tier', option: 'GOLD' }, 'platinum');
    assert.ok(!('error' in plan));
    assert.deepStrictEqual(plan.notes, [{ filePath: 'Teams/Rates.md', write: { values: [{ text: 'platinum' }] } }]);
    assert.deepStrictEqual(plan.schema, { filePath: 'Types/Team.md', line: 11, cell: 1, text: 'Select: platinum, silver, bronze' });
    assert.ok('error' in planOptionRename(typedWorkspace(), { typeKey: 'team', field: 'tier', option: 'gold' }, 'Silver'), 'an option it has');
    assert.ok('error' in planOptionRename(typedWorkspace(), { typeKey: 'team', field: 'tier', option: 'gold' }, 'a, b'));
    assert.ok('error' in planOptionRename(typedWorkspace(), { typeKey: 'team', field: 'lead', option: 'gold' }, 'x'), 'not a select');
  });

  test('rewrites a Kind cell’s option and a table cell, keeping the table aligned', () => {
    assert.strictEqual(renameKindOption('Select: a, b, many', 'b', 'c'), 'Select: a, c, many');
    assert.strictEqual(renameKindOption('Select: a,b, many', 'B', 'c'), 'Select: a,c, many');
    assert.strictEqual(renameKindOption('Person', 'a', 'b'), 'Person');
    assert.strictEqual(rewriteTableCell('| lead      | Person |', 0, 'head'), '| head      | Person |');
    assert.strictEqual(rewriteTableCell('| lead | Person |', 0, 'manager'), '| manager | Person |');
    assert.strictEqual(rewriteTableCell('| lead   | Person |', 0, 'manager'), '| manager | Person |', 'a longer name takes the spaces after it');
    assert.strictEqual(rewriteTableCell('| a | b |', 5, 'x'), '| a | b |');
  });
});

suite('Types as searches: the Hubs view and query blocks', () => {
  test('a namespace heading a type has opens its search', () => {
    const groups = buildHubTree(typedWorkspace(), now);
    assert.deepStrictEqual(groups.map((group) => [group.label, group.typeQuery]), [
      ['People', 'type = person'],
      ['Teams', 'type = team'],
    ]);
  });

  test('noteColumns= reads any field, path, reverse, or computed name, headed as written', () => {
    const options = parseQueryBlockInfo('deckard view=table noteColumns=lead,Team.Lead,owned-by,open-tasks,nonsense');
    assert.ok(options);
    assert.deepStrictEqual(options.noteColumns, ['title', 'field:lead', 'field:Team.Lead', 'field:owned-by', 'field:open-tasks', 'field:nonsense']);
    assert.deepStrictEqual(options.warnings, []);
    const snapshot = createQueryBlockSnapshot(typedWorkspace(), 'type = team', options, { queryContext });
    assert.ok(snapshot.messages.some((message) => message.text.startsWith('noteColumns has no "nonsense"')));
    const rates = snapshot.notes.find((item) => item.filePath === 'Teams/Rates.md');
    assert.ok(rates);
    assert.deepStrictEqual(
      ['field:lead', 'field:open-tasks'].map((column) => describeNoteCell(rates, column as never)),
      ['Dana Whitfield', '2'],
    );
    const incident = createQueryBlockSnapshot(typedWorkspace(), 'type = incident', options, { queryContext }).notes.find((item) => item.filePath === 'Incidents/RFQ outage.md');
    assert.ok(incident);
    assert.strictEqual(describeNoteCell(incident, 'field:Team.Lead'), 'Dana Whitfield', 'a path through the row’s team');
  });

  test('this names the note a block is in', () => {
    const options = parseQueryBlockInfo('deckard');
    assert.ok(options);
    const snapshot = createQueryBlockSnapshot(typedWorkspace(), 'type = incident team = this', options, { queryContext, notePath: 'Teams/Rates.md' });
    assert.deepStrictEqual(snapshot.notes.map((item) => item.filePath), ['Incidents/RFQ outage.md']);
    assert.strictEqual(createQueryBlockSnapshot(typedWorkspace(), 'type = incident team = this', options, { queryContext }).noteCount, 0, 'nothing anywhere else');
  });
});
