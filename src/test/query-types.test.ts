import * as assert from 'assert';

import type { QueryBuilderGroup } from '../domain/model';
import { createQueryContext, QueryContext } from '../domain/query/queryContext';
import { getTopLevelTerms } from '../domain/query/queryEdit';
import { evaluateQuery, evaluateTypeRows } from '../domain/query/queryEvaluator';
import { formatQuery, fromBuilderTree, getQueryTypeKeys, splitFieldValues, toBuilderTree } from '../domain/query/queryFormat';
import { parseQuery } from '../domain/query/queryParser';
import { ANY_FIELD_SCHEMA, QueryNode } from '../domain/query/queryTypes';
import {
  getQueryFieldSchema,
  listTypeQueryFields,
  parseWorkspaceQuery,
  resolveTypeQueryPath,
} from '../domain/types/typeQueryFields';
import { getTypeIndex } from '../domain/types/typeIndex';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const index = typedWorkspace();
const schema = getQueryFieldSchema(index);

/** A query parsed with this workspace's types. */
function parseTyped(text: string): ReturnType<typeof parseQuery> {
  return parseWorkspaceQuery(index, text);
}

/** The notes whose entries, tasks, or front matter a query finds, by path. */
function notesFound(text: string, context: Partial<QueryContext> = {}): string[] {
  const parsed = parseTyped(text);
  assert.deepStrictEqual(parsed.diagnostics, [], text);
  const results = evaluateQuery(index, parsed.node, { ...createQueryContext(now), ...context });
  return [...new Set([...results.sections, ...results.tasks, ...results.files].map((item) => item.filePath))].sort();
}

/** The rows a query finds, by id. */
function rowsFound(text: string, context: Partial<QueryContext> = {}): string[] {
  const parsed = parseTyped(text);
  assert.deepStrictEqual(parsed.diagnostics, [], text);
  return evaluateTypeRows(index, parsed.node, { ...createQueryContext(now), ...context });
}

/** The first diagnostic's message, for a query that should not parse. */
function errorOf(text: string): string {
  const parsed = parseTyped(text);
  assert.strictEqual(parsed.node, undefined, text);
  return parsed.diagnostics[0]?.message ?? '';
}

suite('Query language: type fields', () => {
  test('a workspace with types has a schema; one without has none', () => {
    assert.ok(schema);
    assert.strictEqual(getQueryFieldSchema(indexOf({ 'notes/a.md': '# A' })), undefined);
  });

  test('reads a schema field by its name, after the built-ins', () => {
    const node = parseTyped('lead = @dana').node;
    assert.deepStrictEqual(node, { type: 'field', name: 'lead', operator: 'eq', values: ['@dana'], start: 0, end: 12 });
    // Without the workspace's types it is the error it always was.
    assert.match(parseQuery('lead = @dana').diagnostics[0].message, /not a Deckard query field/);
    // A built-in's name keeps its meaning: `status` is a task's status.
    const status = parseTyped('status = active').node;
    assert.strictEqual(status?.type === 'condition' && status.field, 'status');
  });

  test('reaches a field a built-in takes as field.<name>', () => {
    assert.deepStrictEqual(parseTyped('field.status = active').node, {
      type: 'field',
      name: 'field.status',
      operator: 'eq',
      values: ['active'],
      start: 0,
      end: 21,
    });
    assert.deepStrictEqual(
      listTypeQueryFields(getTypeIndex(index).registry, 'incident').map((field) => field.name).slice(0, 3),
      ['field.owner', 'team', 'severity'],
    );
    assert.strictEqual(parseTyped('field.owner = @dana').node?.type, 'field');
  });

  test('reads paths up to two relations, reverse names included, and no further', () => {
    assert.strictEqual(parseTyped('team.lead = @dana').node?.type, 'field');
    assert.strictEqual(parseTyped('owned-by.lead = @dana').node?.type, 'field');
    assert.strictEqual(parseTyped('lead.team.lead = @dana').node?.type, 'field');
    assert.match(errorOf('lead.team.lead.email = x'), /not a Deckard query field/);
    // A path through a field that names no rows reaches nothing.
    assert.match(errorOf('tier.lead = x'), /not a Deckard query field/);
    assert.deepStrictEqual(
      resolveTypeQueryPath(getTypeIndex(index).registry, 'owned-by.lead').map((field) => field.kind.name),
      ['person'],
    );
  });

  test('reads several values after commas, any of which matches', () => {
    for (const text of ['tier = gold, silver', 'tier = gold,silver', 'tier = gold ,silver', 'tier = "gold", silver']) {
      const node = parseTyped(text).node;
      assert.deepStrictEqual(node?.type === 'field' && node.values, ['gold', 'silver'], text);
    }
    const quoted = parseTyped('owns = "Bond trading", fx').node;
    assert.deepStrictEqual(quoted?.type === 'field' && quoted.values, ['Bond trading', 'fx']);
    // A term after the values is a term of its own.
    const and = parseTyped('tier = gold #team/rates').node;
    assert.strictEqual(and?.type, 'and');
    assert.match(errorOf('tier = gold,'), /another value after the comma/);
  });

  test('takes the operators a field\'s kind compares by, and values its kind reads', () => {
    assert.strictEqual(parseTyped('headcount > 10').node?.type, 'field');
    assert.strictEqual(parseTyped('field.start >= 2026-01-01').node?.type, 'field');
    // `start` is a task's start date; a person's is field.start.
    assert.strictEqual(parseTyped('start >= 2026-01-01').node?.type, 'condition');
    assert.match(errorOf('tier > gold'), /tier does not support ">"/);
    assert.match(errorOf('headcount > lots'), /compares with a number/);
    assert.match(errorOf('field.start = whenever'), /accepts a date/);
    assert.match(errorOf('remote = maybe'), /true or false/);
  });

  test('names a type with type = and is:, and keeps kind for a value no type has', () => {
    const typed = parseTyped('type = Team').node;
    assert.deepStrictEqual(typed?.type === 'condition' && [typed.field, typed.value], ['type', 'team']);
    const is = parseTyped('is:incident').node;
    assert.deepStrictEqual(is?.type === 'condition' && [is.field, is.value], ['type', 'incident']);
    const kind = parseTyped('type = project').node;
    assert.deepStrictEqual(kind?.type === 'condition' && [kind.field, kind.value], ['kind', 'project']);
    const open = parseTyped('is:open').node;
    assert.deepStrictEqual(open?.type === 'condition' && [open.field, open.value], ['is', 'open']);
    // Without types, `type =` is `kind =`, as it was.
    const untyped = parseQuery('type = team').node;
    assert.strictEqual(untyped?.type === 'condition' && untyped.field, 'kind');
    assert.deepStrictEqual(getQueryTypeKeys(parseTyped('type = team tier = gold').node), ['team']);
  });

  test('asks whether a field is filled with has:, -has:, and no:', () => {
    const has = parseTyped('has:on-call').node;
    assert.deepStrictEqual(has?.type === 'condition' && [has.field, has.operator, has.value], ['has', 'eq', 'on-call']);
    const no = parseTyped('no:email').node;
    assert.deepStrictEqual(no?.type === 'condition' && [no.field, no.operator, no.value], ['has', 'neq', 'email']);
    assert.strictEqual(parseTyped('-has:email').node?.type, 'not');
    assert.match(errorOf('has:colour'), /has: and no: accept/);
  });

  test('an unknown field names the type fields it could have meant', () => {
    assert.match(errorOf('leed = @dana'), /"leed" is not a Deckard query field\. Did you mean lead\b/);
    assert.match(errorOf('team.leed = @dana'), /Did you mean team\.lead/);
    assert.match(errorOf('colour = red'), /Use one of: tag/);
  });

  test('formats each new shape so it reads back the same', () => {
    for (const [text, canonical] of [
      ['lead = @dana', 'lead = @dana'],
      ['tier = gold,silver', 'tier = gold, silver'],
      ['owns = "Bond trading"', 'owns = "Bond trading"'],
      ['owns = "Smith, Jones"', 'owns = "Smith, Jones"'],
      ['team.lead = @dana', 'team.lead = @dana'],
      ['owned-by.lead = dana', 'owned-by.lead = dana'],
      ['-lead = @dana', 'NOT lead = @dana'],
      ['headcount >= 10', 'headcount >= 10'],
      ['field.status = active', 'field.status = active'],
      ['is:team', 'type = team'],
      ['has:on-call no:email', 'has:on-call AND no:email'],
      ['team = this', 'team = this'],
      ['team = [[Rates]]', 'team = [[Rates]]'],
    ]) {
      const formatted = formatQuery(parseTyped(text).node);
      assert.strictEqual(formatted, canonical, text);
      assert.deepStrictEqual(stripOffsets(parseTyped(formatted).node), stripOffsets(parseTyped(text).node), `${text} reads back`);
    }
  });

  test('a term of a type field is removed alone, the rest kept as written', () => {
    const terms = getTopLevelTerms(parseTyped('type = team tier = gold, silver #team/rates'));
    assert.deepStrictEqual(
      terms.map((term) => [term.text, term.without]),
      [
        ['type = team', 'tier = gold, silver #team/rates'],
        ['tier = gold, silver', 'type = team #team/rates'],
        ['#team/rates', 'type = team tier = gold, silver'],
      ],
    );
    // The shape reads without the workspace's types too.
    assert.ok(parseQuery('lead = @dana is:team', ANY_FIELD_SCHEMA).node);
  });
});

suite('Query language: what type fields find', () => {
  test('a schema field finds the entries of the note whose row matches, its value resolved as front matter is', () => {
    assert.deepStrictEqual(notesFound('lead = @dana'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('lead = dana'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('lead = "Dana Whitfield"'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('lead = #person/omar'), ['Teams/Credit.md']);
    assert.deepStrictEqual(notesFound('owns = "Bond trading"'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('owns = #area/fx'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('on-call ~ priya'), ['Teams/Rates.md']);
  });

  test('a note type\'s field finds the note row\'s own entries', () => {
    assert.deepStrictEqual(notesFound('severity = sev1'), ['Incidents/RFQ outage.md']);
    assert.deepStrictEqual(notesFound('field.owner = @dana'), ['Incidents/RFQ outage.md']);
    assert.deepStrictEqual(notesFound('team = rates'), ['Incidents/RFQ outage.md', 'People/Dana Whitfield.md']);
  });

  test('a select matches any of its values, in any case', () => {
    assert.deepStrictEqual(notesFound('tier = gold, silver'), ['Teams/Credit.md', 'Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('tier = GOLD'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('tier != gold'), notesFound('NOT tier = gold'));
  });

  test('numbers, dates, and checkboxes compare by kind', () => {
    assert.deepStrictEqual(notesFound('headcount > 10'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('headcount <= 8'), ['Teams/Credit.md']);
    assert.deepStrictEqual(notesFound('headcount = 1200'), ['Teams/Rates.md']);
    assert.deepStrictEqual(notesFound('field.start > 2026-01-01'), ['People/Dana Whitfield.md']);
    assert.deepStrictEqual(notesFound('field.start < 2026-01-01'), []);
    assert.deepStrictEqual(notesFound('field.start = 2026-03-01'), ['People/Dana Whitfield.md']);
    assert.deepStrictEqual(notesFound('field.start < 30d'), ['People/Dana Whitfield.md']);
    assert.deepStrictEqual(notesFound('field.start > 30d'), []);
    assert.deepStrictEqual(notesFound('remote = true'), ['People/Dana Whitfield.md']);
    assert.deepStrictEqual(notesFound('remote = false'), []);
  });

  test('a path follows relations and reverses, up to two hops', () => {
    // Dana's team is Rates, whose lead is Dana; RFQ outage's team is Rates.
    assert.deepStrictEqual(notesFound('team.lead = @dana'), ['Incidents/RFQ outage.md', 'People/Dana Whitfield.md']);
    assert.deepStrictEqual(notesFound('team.lead = omar'), ['Incidents/Feed lag.md', 'People/Omar Haddad.md']);
    assert.deepStrictEqual(notesFound('lead-of.tier = gold'), ['People/Dana Whitfield.md']);
    assert.deepStrictEqual(notesFound('team.lead.email ~ example.com'), ['Incidents/RFQ outage.md', 'People/Dana Whitfield.md']);
  });

  test('has: and no: ask whether a row\'s field is filled', () => {
    assert.deepStrictEqual(notesFound('has:on-call'), ['Teams/Rates.md']);
    // Omar's note is on #team/credit by its front matter, and the standup is
    // on #team/rates; neither note is a row with an on-call.
    assert.deepStrictEqual(notesFound('type = team no:on-call'), ['People/Omar Haddad.md', 'Teams/Credit.md', 'notes/standup.md']);
    assert.deepStrictEqual(notesFound('type = team no:on-call -#team/rates'), ['People/Omar Haddad.md', 'Teams/Credit.md']);
    // Rates' note is on @dana by its front matter, and is no person's row.
    assert.deepStrictEqual(notesFound('type = person -has:email'), ['People/Omar Haddad.md', 'People/Priya Natarajan.md', 'Teams/Rates.md']);
    assert.deepStrictEqual(rowsFound('type = person -has:email'), ['@omar', '@priya']);
  });

  test('field.<name> reaches the field a built-in takes', () => {
    assert.deepStrictEqual(notesFound('field.status = active'), ['Teams/Rates.md']);
  });

  test('type = finds a type\'s rows: its notes, and for a namespace, the entries its tags are on', () => {
    // Omar's front matter writes #team/credit as a tag, which tags his note.
    assert.deepStrictEqual(notesFound('type = team'), ['People/Omar Haddad.md', 'Teams/Credit.md', 'Teams/Rates.md', 'notes/standup.md']);
    assert.deepStrictEqual(notesFound('is:incident'), ['Incidents/Feed lag.md', 'Incidents/RFQ outage.md']);
    assert.deepStrictEqual(notesFound('type = area'), ['Teams/Rates.md', 'notes/areas.md']);
    assert.deepStrictEqual(notesFound('type = team is:task'), ['Teams/Rates.md', 'notes/standup.md']);
  });

  test('this is the note a query block is in, and nothing anywhere else', () => {
    assert.deepStrictEqual(notesFound('team = this', { thisNotePath: 'Teams/Rates.md' }), [
      'Incidents/RFQ outage.md',
      'People/Dana Whitfield.md',
    ]);
    assert.deepStrictEqual(notesFound('lead-of = this', { thisNotePath: 'Teams/Credit.md' }), ['People/Omar Haddad.md']);
    assert.deepStrictEqual(notesFound('lead-of = this', { thisNotePath: 'notes/plain.md' }), []);
    assert.deepStrictEqual(notesFound('team = this'), []);
  });

  test('a computed field compares by its kind', () => {
    // The standup is on #team/rates, but its note is no row.
    assert.deepStrictEqual(notesFound('type = team open-tasks > 0'), ['Teams/Rates.md']);
    assert.deepStrictEqual(rowsFound('type = team open-tasks > 0'), ['#team/rates']);
  });
});

suite('Query language: a search\'s rows', () => {
  test('lists the rows of a type, in the type index\'s order', () => {
    assert.deepStrictEqual(rowsFound('type = team'), ['#team/rates', '#team/credit']);
    assert.deepStrictEqual(rowsFound('type = incident'), ['file:Incidents/RFQ outage.md', 'file:Incidents/Feed lag.md']);
  });

  test('a row matches a type field\'s condition by its own field', () => {
    assert.deepStrictEqual(rowsFound('type = team tier = gold'), ['#team/rates']);
    assert.deepStrictEqual(rowsFound('type = team -tier = gold'), ['#team/credit']);
    assert.deepStrictEqual(rowsFound('type = area owned-by.lead = @dana').sort(), ['#area/bond-trading', '#area/fx']);
    assert.deepStrictEqual(rowsFound('type = person team.tier = silver'), ['@omar']);
    assert.deepStrictEqual(rowsFound('type = incident severity = sev1'), ['file:Incidents/RFQ outage.md']);
    assert.deepStrictEqual(rowsFound('type = team has:on-call'), ['#team/rates']);
  });

  test('a row matches any other condition when one of its entries does', () => {
    assert.deepStrictEqual(rowsFound('type = team is:overdue'), ['#team/rates']);
    assert.deepStrictEqual(rowsFound('type = team -is:overdue'), ['#team/credit']);
    assert.deepStrictEqual(rowsFound('type = team text ~ pricing'), ['#team/rates']);
  });

  test('this names the rows of the query block\'s note', () => {
    assert.deepStrictEqual(rowsFound('type = person team = this', { thisNotePath: 'Teams/Rates.md' }), ['@dana']);
  });

  test('a workspace with no types has no rows', () => {
    const plain = indexOf({ 'notes/a.md': '# A #team/x' });
    assert.deepStrictEqual(evaluateTypeRows(plain, parseQuery('type = team').node, createQueryContext(now)), []);
  });
});

suite('Query language: type fields in the builder', () => {
  test('a typed field query projects to editable rows and back', () => {
    const text = 'type = team tier = gold, silver -lead = @dana owns = "Smith, Jones"';
    const tree = toBuilderTree(parseTyped(text).node);
    assert.deepStrictEqual(rowsOf(tree), [
      ['type', 'eq', 'team', true],
      ['tier', 'eq', 'gold, silver', true],
      ['lead', 'neq', '@dana', true],
      ['owns', 'eq', '"Smith, Jones"', true],
    ]);
    const written = fromBuilderTree(tree);
    assert.strictEqual(written, 'type = team AND tier = gold, silver AND lead != @dana AND owns = "Smith, Jones"');
    assert.deepStrictEqual(stripOffsets(parseTyped(written).node), stripOffsets(parseTyped('type = team tier = gold, silver lead != @dana owns = "Smith, Jones"').node));
    assert.deepStrictEqual(splitFieldValues('gold, "a, b",silver'), ['gold', 'a, b', 'silver']);
  });
});

/** A builder tree's rows, flattened, as [field, operator, value, editable]. */
function rowsOf(group: QueryBuilderGroup): Array<[string, string, string, boolean]> {
  return group.items.flatMap((item) => ('items' in item ? rowsOf(item) : [[item.field, item.operator, item.value, item.supported] as [string, string, string, boolean]]));
}

/** A parsed query without the offsets of its conditions, to compare two spellings of one query. */
function stripOffsets(node: QueryNode | undefined): unknown {
  return JSON.parse(JSON.stringify(node ?? null, (key, value: unknown) => (key === 'start' || key === 'end' ? undefined : value)));
}
