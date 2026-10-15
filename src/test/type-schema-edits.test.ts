import * as assert from 'assert';

import { editSchemaTable, type SchemaEditResult } from '../domain/types/typeSchemaEdits';

const lines = (...text: string[]): string => text.join('\n');

/** The note after an edit, or a failure naming what the edit came to instead. */
function written(result: SchemaEditResult): string {
  assert.strictEqual(result.kind, 'edit', `wrote nothing: ${JSON.stringify(result)}`);
  return result.kind === 'edit' ? result.content : '';
}

const ORG = lines(
  '---',
  'deckard-type: org',
  'rows: "#org/*"',
  '---',
  '# Org',
  '',
  '| Field | Kind | Notes |',
  '| :-- | --- | --: |',
  '| `lead` | Person | the boss |',
  '| channel | Text |',
  '',
  'Every org.',
);

suite('Type builder: editing a type note\'s table', () => {
  test('adds a field as the last row, aligned, adding the column its reverse needs and keeping columns and backticks', () => {
    const result = editSchemaTable(ORG, { kind: 'add', field: { name: 'Distribution List', kind: 'Person, many', reverse: 'on distribution list for' } });
    assert.strictEqual(
      written(result),
      lines(
        '---',
        'deckard-type: org',
        'rows: "#org/*"',
        '---',
        '# Org',
        '',
        '| Field             | Kind         | Reverse                  | Notes    |',
        '| :---------------- | ------------ | ------------------------ | -------: |',
        '| `lead`            | Person       |                          | the boss |',
        '| channel           | Text         |                          |          |',
        '| Distribution List | Person, many | on distribution list for |          |',
        '',
        'Every org.',
      ),
    );
    assert.ok(result.kind === 'edit' && result.line === 11 && result.start === 6 && result.deleted === 4 && result.lines.length === 5);
  });

  test('refuses a name that cannot be a key, or one the table has as a key', () => {
    assert.deepStrictEqual(editSchemaTable(ORG, { kind: 'add', field: { name: 'cost ($)', kind: 'Number' } }), { kind: 'refused', reason: 'bad-name', line: 7 });
    assert.deepStrictEqual(editSchemaTable(ORG, { kind: 'add', field: { name: 'LEAD', kind: 'Text' } }), { kind: 'refused', reason: 'name-taken', line: 9 });
    assert.deepStrictEqual(editSchemaTable(ORG, { kind: 'set', field: 'channel', cells: { name: 'lead' } }), { kind: 'refused', reason: 'name-taken', line: 9 });
    assert.deepStrictEqual(editSchemaTable(ORG, { kind: 'remove', field: 'nothing' }), { kind: 'refused', reason: 'no-field', line: 7 });
  });

  test('sets a field\'s cells by its key, keeping its backticks, and clears a cell set empty', () => {
    const renamed = written(editSchemaTable(ORG, { kind: 'set', field: 'LEAD', cells: { name: 'Team Lead', kind: 'Person or Team', alsoCalled: ['head', ' owner '] } }));
    assert.ok(renamed.includes('| `Team Lead` | Person or Team | head, owner | the boss |'), renamed);
    const cleared = written(editSchemaTable(renamed, { kind: 'set', field: 'team-lead', cells: { alsoCalled: [] } }));
    assert.ok(cleared.includes('| `Team Lead` | Person or Team |             | the boss |'), cleared);
    const aligned = written(editSchemaTable(ORG, { kind: 'realign' }));
    assert.deepStrictEqual(editSchemaTable(aligned, { kind: 'set', field: 'channel', cells: { reverse: '' } }).kind, 'unchanged', 'an empty cell adds no column');
  });

  test('moves a row up or down, and does nothing at the edge', () => {
    const moved = editSchemaTable(ORG, { kind: 'move', field: 'channel', by: -1 });
    assert.ok(written(moved).indexOf('| channel') < written(moved).indexOf('| `lead`'));
    assert.ok(moved.kind === 'edit' && moved.line === 9);
    assert.strictEqual(editSchemaTable(written(moved), { kind: 'move', field: 'channel', by: -1 }).kind, 'unchanged');
  });

  test('removes a row and leaves the rest as they were, realigned', () => {
    const removed = editSchemaTable(ORG, { kind: 'remove', field: 'lead' });
    assert.strictEqual(
      written(removed),
      lines('---', 'deckard-type: org', 'rows: "#org/*"', '---', '# Org', '', '| Field   | Kind | Notes |', '| :------ | ---- | ----: |', '| channel | Text |       |', '', 'Every org.'),
    );
    assert.ok(removed.kind === 'edit' && removed.line === undefined);
  });

  test('realigns a ragged table, and leaves an aligned one alone', () => {
    const aligned = written(editSchemaTable(ORG, { kind: 'realign' }));
    assert.ok(aligned.includes('| `lead`  | Person | the boss |'), aligned);
    assert.strictEqual(editSchemaTable(aligned, { kind: 'realign' }).kind, 'unchanged');
  });

  test('reads the table as the parser does: not in a code fence, and keeps the note\'s line endings', () => {
    const fenced = lines('# Org', '```', '| Field | Kind |', '| --- | --- |', '```', '| Field | Kind |', '| --- | --- |', '| tier | Text |').replace(/\n/g, '\r\n');
    const result = written(editSchemaTable(fenced, { kind: 'remove', field: 'tier' }));
    assert.strictEqual(result, lines('# Org', '```', '| Field | Kind |', '| --- | --- |', '```', '| Field | Kind |', '| ----- | ---- |').replace(/\n/g, '\r\n'));
  });

  test('gives a note with no table one under its heading when a field is added', () => {
    const result = editSchemaTable(lines('---', 'deckard-type: org', '---', '# Org', 'Every org.'), { kind: 'add', field: { name: 'tier', kind: 'Select: gold, silver' } });
    assert.strictEqual(
      written(result),
      lines(
        '---',
        'deckard-type: org',
        '---',
        '# Org',
        '',
        '| Field | Kind                 | Reverse | Also called |',
        '| ----- | -------------------- | ------- | ----------- |',
        '| tier  | Select: gold, silver |         |             |',
        '',
        'Every org.',
      ),
    );
    assert.ok(result.kind === 'edit' && result.line === 8);
    assert.deepStrictEqual(editSchemaTable('# Org', { kind: 'remove', field: 'tier' }), { kind: 'refused', reason: 'no-table', line: 1 });
  });
});
