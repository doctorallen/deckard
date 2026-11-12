import * as assert from 'assert';

import { normalizePreferences } from '../core/storage/preferencesSchema';
import { createQueryContext } from '../domain/query/queryContext';
import type { TypeTableView } from '../domain/model';
import type { SearchPageTypeRows, TypeBoard, TypeBoardValue } from '../ui/protocol/searchPage';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { describeBoardMove, moveFieldValues, planTypeBoardMove, startValuesFor } from '../ui/state/typeBoard';
import { narrowSearchPageMessage } from '../ui/webview/pages/searchPage/messages';
import { createPreferences } from './preferenceServices';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const queryContext = createQueryContext(now);
const lines = (...text: string[]): string => text.join('\n');

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

/** The board of a type's rows tab on Board, with its Group and Lanes. */
function boardOf(query: string, view: TypeTableView = {}, index = typedWorkspace()): TypeBoard {
  const table = rowsTab(query, { view: 'board', ...view }, index);
  assert.ok(table.board, `${query} draws a board`);
  return table.board;
}

/** An axis's values as `label count`. */
function valuesOf(values: readonly TypeBoardValue[]): string[] {
  return values.map((value) => `${value.label} ${value.count}`);
}

/** Each card as `row column lane`. */
function cardsOf(board: TypeBoard): string[] {
  return board.cards.map((card) => [card.rowId, card.column, card.lane].filter((part) => part !== undefined).join(' '));
}

/** Initiatives, a type of notes a reader writes, with a state, a team, and owners. */
function initiatives() {
  return indexOf({
    'Types/Team.md': lines('---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '', '| Field | Kind |', '| ----- | ---- |', '| lead | Person |'),
    'Types/Initiative.md': lines(
      '---',
      'deckard-type: initiative',
      'rows: notes',
      '---',
      '# Initiative',
      '',
      '| Field  | Kind                                    |',
      '| ------ | --------------------------------------- |',
      '| state  | Select: proposed, active, paused, done  |',
      '| team   | Team                                    |',
      '| owners | Person, many                            |',
      '| target | Date                                    |',
    ),
    'notes/teams.md': lines('# Teams #team/payments #team/rates #team/credit'),
    'Initiatives/Card vault.md': lines('---', 'type: initiative', 'state: active', 'team: "#team/payments"', 'owners: ["@dana", "@omar"]', 'target: 2026-12-01', '---', '# Card vault'),
    'Initiatives/Swap pricing.md': lines('---', 'type: initiative', 'state: proposed', 'team: "#team/rates"', '---', '# Swap pricing'),
    'Initiatives/Ledger cleanup.md': lines('---', 'type: initiative', 'owners: ["@dana"]', '---', '# Ledger cleanup'),
  });
}

suite('Boards on a type’s rows: columns and lanes', () => {
  test('Group by offers each select, person, and relation field, then each reverse, and groups the table by a reverse', () => {
    const teams = rowsTab('type = team');
    assert.deepStrictEqual(teams.groupFields.map((field) => [field.id, field.label]), [
      ['lead', 'lead'], ['owns', 'owns'], ['tier', 'tier'], ['on-call', 'on-call'], ['members', 'members'], ['team-of', 'team of'],
    ]);
    assert.strictEqual(teams.view, 'table');
    assert.strictEqual(teams.board, undefined, 'the table draws no board');
    assert.deepStrictEqual(rowsTab('type = team', { groupBy: 'members' }).groups?.map((group) => [group.label, group.rows.map((row) => row.title)]), [
      ['Dana Whitfield', ['Rates']],
      ['Omar Haddad', ['Credit']],
    ]);
  });

  test('a select’s columns are its options in the schema’s order, empty ones too, then No …', () => {
    const board = boardOf('type = team', { boardGroup: 'tier' });
    assert.deepStrictEqual([board.group.field, board.group.name, board.group.writable], ['tier', 'tier', true]);
    assert.deepStrictEqual(valuesOf(board.group.values), ['gold 1', 'silver 1', 'bronze 0', 'No tier 0']);
    assert.deepStrictEqual(board.group.values.map((value) => value.written), ['gold', 'silver', 'bronze', undefined]);
    assert.deepStrictEqual(cardsOf(board), ['#team/credit option:silver', '#team/rates option:gold'], 'in the table’s order, by title');
  });

  test('a relation’s columns are every row of its type, by title; a person’s only those in use; No … last', () => {
    const board = boardOf('type = initiative', { boardGroup: 'team', boardLanes: 'owners' }, initiatives());
    assert.deepStrictEqual(valuesOf(board.group.values), ['Credit 0', 'Payments 1', 'Rates 1', 'No team 1']);
    assert.deepStrictEqual(board.group.values.map((value) => value.id), ['row:#team/credit', 'row:#team/payments', 'row:#team/rates', 'none']);
    assert.ok(board.lanes);
    assert.deepStrictEqual(board.lanes.values.map((value) => [value.id, value.count, value.written]), [
      ['row:@dana', 2, '@dana'],
      ['row:@omar', 1, '@omar'],
      ['none', 1, undefined],
    ], 'people in use, by title');
  });

  test('a row with two values is a card in each of their cells', () => {
    const board = boardOf('type = initiative', { boardGroup: 'state', boardLanes: 'owners' }, initiatives());
    assert.deepStrictEqual(cardsOf(board), [
      'file:Initiatives/Card vault.md option:active row:@dana',
      'file:Initiatives/Card vault.md option:active row:@omar',
      'file:Initiatives/Ledger cleanup.md none row:@dana',
      'file:Initiatives/Swap pricing.md option:proposed none',
    ]);
    assert.deepStrictEqual(valuesOf(board.group.values), ['proposed 1', 'active 1', 'paused 0', 'done 0', 'No state 1']);
  });

  test('a reverse’s values are those in use, it takes no drop, and No … only when some row has none', () => {
    const board = boardOf('type = team', { boardGroup: 'tier', boardLanes: 'members' });
    assert.ok(board.lanes);
    assert.deepStrictEqual([board.lanes.field, board.lanes.writable], ['members', false]);
    assert.deepStrictEqual(valuesOf(board.lanes.values), ['Dana Whitfield 1', 'Omar Haddad 1'], 'every team has a member, so no No members');
    assert.deepStrictEqual(valuesOf(boardOf('type = person', { boardGroup: 'lead-of' }).group.values), ['Credit 1', 'Rates 1', 'No lead of 1'], 'Priya leads no team');
  });

  test('Group defaults to the table’s Group by, else the first select, else the first person or relation; Lanes to none', () => {
    assert.strictEqual(boardOf('type = team').group.field, 'tier');
    assert.strictEqual(boardOf('type = team').lanes, undefined);
    assert.strictEqual(boardOf('type = team', { groupBy: 'lead' }).group.field, 'lead');
    assert.strictEqual(boardOf('type = team', { groupBy: 'lead', boardGroup: 'owns' }).group.field, 'owns');
    assert.strictEqual(boardOf('type = person').group.field, 'team', 'no select: the first relation');
    assert.strictEqual(boardOf('type = team', { boardGroup: 'tier', boardLanes: 'tier' }).lanes, undefined, 'never the columns’ own field');
    assert.strictEqual(boardOf('type = team', { boardGroup: 'nothing' }).group.field, 'tier', 'a field the type no longer has');
  });

  test('a type with nothing to group by draws no board, and says it is on Board', () => {
    const terms = indexOf({
      'Types/Term.md': lines('---', 'deckard-type: term', 'rows: notes', '---', '# Term', '', '| Field | Kind |', '| ----- | ---- |', '| term | Text |'),
      'terms/SLO.md': lines('---', 'type: term', 'term: SLO', '---', '# SLO'),
    });
    const table = rowsTab('type = term', { view: 'board' }, terms);
    assert.deepStrictEqual([table.view, table.board, table.groupFields.length], ['board', undefined, 0]);
  });

  test('a card’s details are up to three of the table’s columns that hold something, but the title and the axes', () => {
    const board = boardOf('type = team', { boardGroup: 'tier', boardLanes: 'lead' });
    const rates = board.cards.find((card) => card.rowId === '#team/rates');
    assert.deepStrictEqual(rates?.details.map((detail) => `${detail.label} ${detail.cell.text}`), ['owns Bond Trading, Fx', 'headcount 1,200', 'on-call Priya Natarajan']);
    const credit = board.cards.find((card) => card.rowId === '#team/credit');
    assert.deepStrictEqual(credit?.details.map((detail) => `${detail.label} ${detail.cell.text}`), ['headcount 8', 'Last mentioned today · 2026-10-08'], 'no Open tasks 0');
  });

  test('On Board the rows are not grouped, and keep the table’s sort', () => {
    const table = rowsTab('type = team', { view: 'board', groupBy: 'tier', sort: { column: 'headcount', direction: 'desc' } });
    assert.deepStrictEqual([table.groups, table.groupBy], [undefined, undefined]);
    assert.deepStrictEqual(table.rows.map((row) => row.title), ['Rates', 'Credit']);
    assert.deepStrictEqual(table.board?.cards.map((card) => card.rowId), ['#team/rates', '#team/credit']);
  });

  test('the view, Group, and Lanes are kept for each type, Lanes never the columns’ field', () => {
    assert.deepStrictEqual(
      normalizePreferences({
        typeTables: { team: { view: 'board', boardGroup: 'tier', boardLanes: 'lead' }, person: { view: 'cards', boardLanes: 7 }, area: { boardGroup: 'x', boardLanes: 'x' } },
      } as never).typeTables,
      { team: { view: 'board', boardGroup: 'tier', boardLanes: 'lead' }, area: { boardGroup: 'x' } },
    );
  });
});

suite('Boards on a type’s rows: moves', () => {
  test('a drop changes the column’s field, the lane’s, or both, the column’s first', () => {
    const board = boardOf('type = initiative', { boardGroup: 'state', boardLanes: 'team' }, initiatives());
    const card = 'file:Initiatives/Card vault.md';
    const changes = (to: { column: string; lane?: string }) => {
      const plan = planTypeBoardMove(board, card, { column: 'option:active', lane: 'row:#team/payments' }, to);
      assert.ok(plan && 'changes' in plan, JSON.stringify(plan));
      return plan.changes.map((change) => `${change.axis} ${change.field} ${change.from.label} → ${change.to.label}`);
    };
    assert.deepStrictEqual(changes({ column: 'option:done', lane: 'row:#team/payments' }), ['group state active → done']);
    assert.deepStrictEqual(changes({ column: 'option:active', lane: 'none' }), ['lanes team Payments → No team']);
    assert.deepStrictEqual(changes({ column: 'option:paused', lane: 'row:#team/credit' }), ['group state active → paused', 'lanes team Payments → Credit']);
    assert.deepStrictEqual(changes({ column: 'option:active', lane: 'row:#team/payments' }), [], 'its own cell');
  });

  test('a move names a card the board has, in a cell it has', () => {
    const board = boardOf('type = initiative', { boardGroup: 'state' }, initiatives());
    const card = 'file:Initiatives/Card vault.md';
    assert.strictEqual(planTypeBoardMove(board, card, { column: 'option:proposed' }, { column: 'option:done' }), undefined, 'not the cell it is in');
    assert.strictEqual(planTypeBoardMove(board, card, { column: 'option:active' }, { column: 'option:shipped' }), undefined, 'no such column');
    assert.strictEqual(planTypeBoardMove(board, card, { column: 'option:active' }, { column: 'option:done', lane: 'none' }), undefined, 'no lanes');
    assert.strictEqual(planTypeBoardMove(board, 'file:Nothing.md', { column: 'option:active' }, { column: 'option:done' }), undefined);
  });

  test('a reverse refuses a card moved into another of its values', () => {
    const board = boardOf('type = team', { boardGroup: 'members', boardLanes: 'tier' });
    assert.deepStrictEqual(
      planTypeBoardMove(board, '#team/rates', { column: 'row:@dana', lane: 'option:gold' }, { column: 'row:@omar', lane: 'option:gold' }),
      { refused: 'Members is set by other notes.' },
    );
    const lane = planTypeBoardMove(board, '#team/rates', { column: 'row:@dana', lane: 'option:gold' }, { column: 'row:@dana', lane: 'option:bronze' });
    assert.ok(lane && 'changes' in lane && lane.changes.length === 1, 'its lane, a select, still moves');
  });

  test('a field that holds one takes the new value, or none; one that holds several swaps the one it left', () => {
    const value = (id: string, written?: string): TypeBoardValue => ({ id, label: id, count: 0, ...(written ? { written } : {}) });
    const dana = { text: '@dana', id: 'row:@dana' };
    const omar = { text: 'omar', id: 'row:@omar' };
    assert.deepStrictEqual(moveFieldValues([{ text: 'Active', id: 'option:active' }], false, value('option:active'), value('option:done', 'done')), ['done']);
    assert.deepStrictEqual(moveFieldValues([{ text: 'active', id: 'option:active' }], false, value('option:active'), value('none')), []);
    assert.deepStrictEqual(moveFieldValues([], false, value('none'), value('option:done', 'done')), ['done']);
    assert.deepStrictEqual(moveFieldValues([dana, omar], true, value('row:@dana'), value('row:@priya', '@priya')), ['omar', '@priya'], 'Omar kept as written');
    assert.deepStrictEqual(moveFieldValues([dana, omar], true, value('row:@dana'), value('row:@omar', '@omar')), ['omar'], 'not twice');
    assert.deepStrictEqual(moveFieldValues([dana, omar], true, value('row:@dana'), value('none')), ['omar'], 'No … loses the one it left');
    assert.deepStrictEqual(moveFieldValues([], true, value('none'), value('row:@dana', '@dana')), ['@dana']);
    assert.strictEqual(moveFieldValues([omar], true, value('row:@dana'), value('none')), 'stale', 'set by another note, or changed since');
    assert.strictEqual(moveFieldValues([omar], false, value('none'), value('row:@dana', '@dana')), 'stale');
  });

  test('says where a card went, and a + fills in its column’s and lane’s values', () => {
    const board = boardOf('type = initiative', { boardGroup: 'state', boardLanes: 'team' }, initiatives());
    const plan = planTypeBoardMove(board, 'file:Initiatives/Swap pricing.md', { column: 'option:proposed', lane: 'row:#team/rates' }, { column: 'option:active', lane: 'row:#team/credit' });
    assert.ok(plan && 'changes' in plan);
    assert.strictEqual(describeBoardMove('Swap pricing', plan.changes), 'Moved Swap pricing to active, Credit.');
    assert.deepStrictEqual(startValuesFor(board, { column: 'option:paused', lane: 'row:#team/rates' }), { state: 'paused', team: '#team/rates' });
    assert.deepStrictEqual(startValuesFor(board, { column: 'none', lane: 'row:#team/rates' }), { team: '#team/rates' });
    assert.deepStrictEqual(startValuesFor(board, {}), {});
    assert.deepStrictEqual(startValuesFor(boardOf('type = team', { boardGroup: 'members' }), { column: 'row:@dana' }), {}, 'a reverse is no field to fill');
  });

  test('the view, axis, move, and + messages are validated', () => {
    const accepted = [
      { type: 'setTypeView', typeKey: 'initiative', view: 'board' },
      { type: 'setTypeView', typeKey: 'initiative', view: 'table' },
      { type: 'setTypeBoardAxis', typeKey: 'initiative', axis: 'group', field: 'state' },
      { type: 'setTypeBoardAxis', typeKey: 'initiative', axis: 'lanes' },
      { type: 'moveTypeRow', typeKey: 'initiative', rowId: 'file:Initiatives/Card vault.md', from: { column: 'option:active', lane: 'none' }, to: { column: 'option:done', lane: 'row:#team/rates' } },
      { type: 'moveTypeRow', typeKey: 'team', rowId: '#team/rates', from: { column: 'option:gold' }, to: { column: 'none' } },
      { type: 'addTypeRow', typeKey: 'initiative', column: 'option:paused', lane: 'row:@dana' },
      { type: 'addTypeRow', typeKey: 'initiative', lane: 'row:@dana' },
    ];
    for (const message of accepted) {
      assert.deepStrictEqual(narrowSearchPageMessage(message), message, JSON.stringify(message));
    }
    for (const message of [
      { type: 'setTypeView', typeKey: 'initiative', view: 'cards' },
      { type: 'setTypeView', typeKey: 'initiative' },
      { type: 'setTypeBoardAxis', typeKey: 'initiative', axis: 'rows', field: 'state' },
      { type: 'setTypeBoardAxis', typeKey: 'initiative', axis: 'group', field: '' },
      { type: 'moveTypeRow', typeKey: 'team', rowId: '#team/rates', from: { column: 'option:gold' } },
      { type: 'moveTypeRow', typeKey: 'team', rowId: '#team/rates', from: { column: 'option:gold' }, to: { column: '' } },
      { type: 'moveTypeRow', typeKey: 'team', rowId: '#team/rates', from: { column: 'option:gold' }, to: { column: 'none', extra: 1 } },
      { type: 'moveTypeRow', typeKey: 'team', rowId: '#team/rates', from: 'gold', to: { column: 'none' } },
      { type: 'moveTypeRow', typeKey: 'team', rowId: '', from: { column: 'option:gold' }, to: { column: 'none' } },
      { type: 'addTypeRow', typeKey: 'initiative', column: 7 },
      { type: 'addTypeRow', typeKey: 'initiative', column: 'x'.repeat(5000) },
    ]) {
      assert.strictEqual(narrowSearchPageMessage(message), undefined, JSON.stringify(message));
    }
  });
});
