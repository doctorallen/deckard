import * as assert from 'assert';

import {
  buildTagIntersectionQuery,
  collectQueryTagKeys,
  formatQuery,
  fromBuilderTree,
  getQueryTagIntersection,
  toBuilderTree,
} from '../domain/query/queryFormat';
import { parseQuery } from '../domain/query/queryParser';
import { hasAvailableTerm, toggleAvailable } from '../domain/query/queryEdit';
import {
  QUERY_FIELD_OPERATORS,
  QUERY_OPERATOR_INVERSES,
} from '../domain/query/queryTypes';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { startOfWeek, Weekday } from '../domain/markdown/dates';
import { createQueryContext } from '../domain/query/queryContext';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { ParsedFile, PersistedPreferences, Section, TagInfo, Task, WorkspaceIndex } from '../domain/model';
import { formatIsoDate, startOfDay } from '../domain/markdown/calendar';
import { resolveDateRange } from '../domain/query/queryDates';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { getEntityNamespaceAliases, parseMarkdown } from '../domain/markdown/parser';
import { buildSearchFacets } from '../domain/search/facets';
import { inTimeZone } from './timeZone';

suite('Deckard query language', () => {
  test('parses a bare tag as a tag condition', () => {
    const parsed = parseQuery('#project/atlas');
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.deepStrictEqual(getQueryTagIntersection(parsed.node), [
      '#project/atlas',
    ]);
  });

  test('parses a bare word as a text condition', () => {
    const parsed = parseQuery('vendor');
    assert.strictEqual(parsed.node?.type, 'condition');
    assert.deepStrictEqual(
      parsed.node?.type === 'condition'
        ? [parsed.node.field, parsed.node.operator, parsed.node.value]
        : undefined,
      ['text', 'contains', 'vendor'],
    );
  });

  test('joins adjacent terms with an implicit AND', () => {
    const parsed = parseQuery('#project/atlas #urgent');
    assert.deepStrictEqual(getQueryTagIntersection(parsed.node), [
      '#project/atlas',
      '#urgent',
    ]);
  });

  test('gives OR lower precedence than AND', () => {
    const parsed = parseQuery('tag:#a AND tag:#b OR tag:#c');
    assert.strictEqual(parsed.node?.type, 'or');
    assert.strictEqual(
      formatQuery(parsed.node),
      'tag = #a AND tag = #b OR tag = #c',
    );
  });

  test('parses the grouped example from the feature request', () => {
    const parsed = parseQuery(
      '(tag:#project/skybridge-signal AND tag:@ren-kade) OR (tag:#risk/service-failure AND text ~ "elevator")',
    );
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.strictEqual(parsed.node?.type, 'or');
    assert.deepStrictEqual(collectQueryTagKeys(parsed.node), [
      '#project/skybridge-signal',
      '@ren-kade',
      '#risk/service-failure',
    ]);
  });

  test('keeps a hyphen inside a tag out of negation', () => {
    const parsed = parseQuery('tag:#risk/service-failure');
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.deepStrictEqual(getQueryTagIntersection(parsed.node), [
      '#risk/service-failure',
    ]);
  });

  test('reads a leading dash as NOT', () => {
    const parsed = parseQuery('#a -#b');
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.strictEqual(formatQuery(parsed.node), 'tag = #a AND NOT tag = #b');
  });

  test('reads a comparison written after a colon', () => {
    const parsed = parseQuery('updated:>2026-01-01');
    assert.strictEqual(
      parsed.node?.type === 'condition' ? parsed.node.operator : undefined,
      'gt',
    );
  });

  test('reports an unknown field instead of guessing', () => {
    const parsed = parseQuery('color:red');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /not a Deckard query field/);
  });

  test('a field or value named after a property of every object is unknown like any other', () => {
    const unknownField = parseQuery('color:x');
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const parsed = parseQuery(`${name}:x`);
      assert.strictEqual(parsed.node, undefined, name);
      assert.deepStrictEqual(
        parsed.diagnostics.map((diagnostic) => diagnostic.message),
        unknownField.diagnostics.map((diagnostic) => diagnostic.message.replace('"color"', `"${name}"`)),
        name,
      );
      for (const field of ['is', 'has', 'no', 'task', 'priority']) {
        const unknownValue = parseQuery(`${field}:bogus`);
        const value = parseQuery(`${field}:${name}`);
        assert.strictEqual(value.node, undefined, `${field}:${name}`);
        assert.deepStrictEqual(
          value.diagnostics.map((diagnostic) => diagnostic.message),
          unknownValue.diagnostics.map((diagnostic) => diagnostic.message.replace('"bogus"', `"${name}"`)),
          `${field}:${name}`,
        );
      }
    }
  });

  test('reports an unclosed group', () => {
    const parsed = parseQuery('(tag:#a AND tag:#b');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /closing parenthesis/);
  });

  test('reports an unclosed quote', () => {
    const parsed = parseQuery('text ~ "elevator');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /closing quote/);
  });

  test('rejects an operator a field cannot answer', () => {
    const parsed = parseQuery('tag > #a');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /does not support/);
  });

  test('rejects a task state that is not open, done, or any', () => {
    const parsed = parseQuery('task:maybe');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /open, done, or any/);
  });

  test('treats an empty query as no query at all', () => {
    const parsed = parseQuery('   ');
    assert.strictEqual(parsed.node, undefined);
    assert.deepStrictEqual(parsed.diagnostics, []);
  });

  test('round-trips a query through its canonical text', () => {
    const source =
      '(tag = #a AND text ~ "two words") OR NOT tag = #b OR task = open';
    const formatted = formatQuery(parseQuery(source).node);
    assert.strictEqual(formatted, formatQuery(parseQuery(formatted).node));
  });

  test('writes equality with = and still accepts :', () => {
    assert.strictEqual(
      formatQuery(parseQuery('tag:#a').node),
      'tag = #a',
      'the canonical form should use =',
    );
    assert.strictEqual(
      formatQuery(parseQuery('tag = #a').node),
      formatQuery(parseQuery('tag:#a').node),
      ': should remain a synonym for =',
    );
  });

  test('quotes a value that would otherwise re-tokenize', () => {
    const formatted = formatQuery(parseQuery('text ~ "a (b) c"').node);
    assert.strictEqual(formatted, 'text ~ "a (b) c"');
    assert.deepStrictEqual(parseQuery(formatted).diagnostics, []);
  });

  test('quotes a value that is a word joining terms, so the query still reads', () => {
    for (const [source, written] of [
      ['"not"', 'text ~ "not"'],
      ['"or" #work', 'text ~ "or" AND tag = #work'],
      ['text ~ "AND"', 'text ~ "AND"'],
      ['file = "Or"', 'file = "Or"'],
      ['text ~ "&&"', 'text ~ "&&"'],
      ['text ~ "||x"', 'text ~ "||x"'],
    ]) {
      const parsed = parseQuery(source);
      assert.strictEqual(formatQuery(parsed.node), written, source);
      assert.deepStrictEqual(parseQuery(written).diagnostics, [], written);
      assert.strictEqual(
        formatQuery(parseQuery(fromBuilderTree(toBuilderTree(parsed.node))).node),
        written,
        `${source} through the builder`,
      );
    }
    assert.strictEqual(formatQuery(parseQuery('text ~ "band"').node), 'text ~ band');
  });

  test('expresses a tag intersection as the query the chips imply', () => {
    const query = buildTagIntersectionQuery(['#project/atlas', '@ren-kade']);
    assert.strictEqual(query, 'tag = #project/atlas AND tag = @ren-kade');
    assert.deepStrictEqual(getQueryTagIntersection(parseQuery(query).node), [
      '#project/atlas',
      '@ren-kade',
    ]);
  });

  test('does not mistake a wildcard tag for a plain intersection', () => {
    assert.strictEqual(
      getQueryTagIntersection(parseQuery('tag:#project/*').node),
      undefined,
    );
  });

  test('does not mistake a negated tag for a plain intersection', () => {
    assert.strictEqual(
      getQueryTagIntersection(parseQuery('tag:#a AND NOT tag:#b').node),
      undefined,
    );
  });

  test('round-trips a query through the visual builder', () => {
    const source = '(tag:#a AND task:open) OR text ~ "vendor"';
    const tree = toBuilderTree(parseQuery(source).node);
    assert.strictEqual(tree.join, 'or');
    assert.strictEqual(tree.items.length, 2);
    assert.ok('items' in tree.items[0] && tree.items[0].items.length === 2);
    // A nested group keeps its parentheses for legibility, so the round trip
    // is checked by meaning rather than by spelling.
    assert.strictEqual(
      formatQuery(parseQuery(fromBuilderTree(tree)).node),
      formatQuery(parseQuery(source).node),
    );
  });

  test('folds a negated condition into its opposite operator', () => {
    const tree = toBuilderTree(parseQuery('NOT tag:#a').node);
    const row = tree.items[0];
    assert.ok(!('items' in row));
    assert.strictEqual(row.operator, 'neq');
    assert.strictEqual(fromBuilderTree(tree), 'tag != #a');
  });

  test('keeps a negated comparison meaningful as one operator', () => {
    const tree = toBuilderTree(parseQuery('NOT updated > 7d').node);
    const row = tree.items[0];
    assert.ok(!('items' in row));
    assert.strictEqual(row.operator, 'lte');
    assert.strictEqual(fromBuilderTree(tree), 'updated <= 7d');
  });

  test('offers an opposite for every operator a field accepts', () => {
    for (const [field, operators] of Object.entries(QUERY_FIELD_OPERATORS)) {
      for (const operator of operators) {
        assert.ok(
          operators.includes(QUERY_OPERATOR_INVERSES[operator]),
          `${field} accepts ${operator} but not its opposite`,
        );
      }
    }
  });

  test('shows a negated group as a group turned around, not as text', () => {
    // The whole query is the negated group, so it is the root: turned around,
    // matching any of its two rows.
    const tree = toBuilderTree(parseQuery('NOT (tag:#a OR tag:#b)').node);
    assert.strictEqual(tree.join, 'or');
    assert.strictEqual(tree.negated, true);
    assert.deepStrictEqual(tree.items.map((item) => ('items' in item ? '' : item.value)), ['#a', '#b']);
    assert.strictEqual(fromBuilderTree(tree), 'NOT (tag = #a OR tag = #b)');
  });

  test('shows an OR of tags with a NOT beside it as a group and a row', () => {
    // What Refine makes: three tags allowed, then one left out with Alt.
    const tree = toBuilderTree(parseQuery('(tag:#a OR tag:#b OR tag:#c) AND NOT tag:#d').node);
    assert.strictEqual(tree.join, 'and');
    assert.strictEqual(tree.items.length, 2);
    const group = tree.items[0];
    assert.ok('items' in group && group.join === 'or' && group.items.length === 3);
    const row = tree.items[1];
    assert.ok(!('items' in row) && row.operator === 'neq' && row.value === '#d');
    assert.strictEqual(fromBuilderTree(tree), '(tag = #a OR tag = #b OR tag = #c) AND tag != #d');
  });

  test('keeps a group nested three deep, with its parentheses, on the way back', () => {
    const source = '((tag:#a OR tag:#b) AND task:open) OR tag:#c';
    const tree = toBuilderTree(parseQuery(source).node);
    assert.strictEqual(fromBuilderTree(tree), '((tag = #a OR tag = #b) AND task = open) OR tag = #c');
    assert.strictEqual(
      formatQuery(parseQuery(fromBuilderTree(tree)).node),
      formatQuery(parseQuery(source).node),
    );
  });

  test('matches an OR of two tag intersections', () => {
    const index = createIndex();
    const results = evaluateQuery(
      index,
      parseQuery('(tag:#project/atlas AND tag:@ren) OR tag:#risk/vendor').node,
      createQueryContext(Date.now()),
    );
    assert.deepStrictEqual(
      results.sections.map((section) => section.id).sort(),
      ['atlas-ren', 'vendor'],
    );
  });

  test('reads text = as a whole word, and text: and text ~ as any part of one, as the guide says', () => {
    const file = parseMarkdown(
      'notes/n.md',
      '# Sprint\n- [ ] Finish the planning doc\n- [ ] Write the plan\n',
    );
    const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
    const titles = (text: string) =>
      evaluateQuery(index, parseQuery(text).node, createQueryContext(Date.now())).tasks.map(
        (task) => task.title,
      );
    assert.deepStrictEqual(titles('text = plan'), ['Write the plan']);
    assert.deepStrictEqual(titles('text != plan'), ['Finish the planning doc']);
    for (const contains of ['text:plan', 'text ~ plan', 'plan']) {
      assert.deepStrictEqual(titles(contains), ['Finish the planning doc', 'Write the plan'], contains);
    }
    assert.strictEqual(formatQuery(parseQuery('text = plan').node), 'text = plan');
    assert.strictEqual(formatQuery(parseQuery('text:plan').node), 'text ~ plan');
  });

  test('matches text inside a section body', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('text ~ elevator').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(
      results.sections.map((section) => section.id),
      ['vendor'],
    );
  });

  test('combines a tag and a text condition', () => {
    const index = createIndex();
    const results = evaluateQuery(
      index,
      parseQuery('tag:#risk/vendor AND text ~ "elevator"').node,
      createQueryContext(Date.now()),
    );
    assert.strictEqual(results.sections.length, 1);
  });

  test('excludes with NOT', () => {
    const index = createIndex();
    const ids = evaluateQuery(
      index,
      parseQuery('tag:#project/atlas AND NOT tag:@ren').node,
      createQueryContext(Date.now()),
    ).sections.map((section) => section.id);
    assert.ok(ids.includes('atlas-solo'));
    assert.ok(
      !ids.includes('atlas-ren'),
      'the section carrying @ren should be excluded',
    );
  });

  test('inherits a tag from a parent heading', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('tag:#project/atlas').node, createQueryContext(Date.now()));
    assert.ok(
      results.sections.some((section) => section.id === 'atlas-child'),
      'a nested section should answer for its parent heading tag',
    );
  });

  test('matches a namespace with a wildcard', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('tag:#risk/*').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(
      results.sections.map((section) => section.id),
      ['vendor'],
    );
  });

  test('finds a tag and a kind by a namespace alias, as the note was written', () => {
    // A workspace's own alias, as the settings give it, merged over the built-in ones.
    const aliases = { entityNamespaceAliases: getEntityNamespaceAliases({ proj: 'project' }) };
    const file = parseMarkdown('notes/acme.md', '# Acme #organization/acme\n\n# Atlas #proj/atlas\n', undefined, aliases);
    const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
    const headings = (text: string, settings = {}) =>
      evaluateQuery(index, parseQuery(text).node, createQueryContext(Date.now(), settings)).sections.map(
        (section) => section.heading.split(' #')[0],
      );
    for (const text of ['#organization/acme', '#org/acme', 'tag = organization/acme', '#organization/*', 'kind = organization', 'kind = org']) {
      assert.deepStrictEqual(headings(text), ['Acme'], text);
    }
    assert.deepStrictEqual(headings('-#organization/acme'), ['Atlas']);
    for (const text of ['#proj/atlas', 'kind = proj', '#project/atlas']) {
      assert.deepStrictEqual(headings(text, aliases), ['Atlas'], text);
    }
  });

  test('matches an entity namespace by kind', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('kind:person').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(
      results.sections.map((section) => section.id),
      ['atlas-ren'],
    );
  });

  test('answers a task state only from tasks', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('task:open').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(
      results.tasks.map((task) => task.id),
      ['task-open'],
    );
    assert.deepStrictEqual(results.sections, []);
  });

  test('matches a file name glob', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('file:2026-09-*.md').node, createQueryContext(Date.now()));
    assert.ok(results.sections.length > 0);
    assert.ok(
      results.sections.every((section) =>
        section.filePath.includes('2026-09-'),
      ),
    );
  });

  test('matches a front-matter-only note as a file result', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('tag:#topic/intro').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(
      results.files.map((file) => file.filePath),
      ['notes/intro.md'],
    );
  });

  test('answers a negated whole-word text condition', () => {
    const index = createIndex();
    const ids = evaluateQuery(
      index,
      parseQuery('tag:#project/atlas AND text != Sequencing').node,
      createQueryContext(Date.now()),
    ).sections.map((section) => section.id);
    assert.ok(!ids.includes('atlas-solo'));
    assert.ok(ids.includes('atlas-ren'));
  });

  test('answers a path that does not contain a fragment', () => {
    const index = createIndex();
    const results = evaluateQuery(
      index,
      parseQuery('tag:#project/atlas AND path !~ 2026-09-08').node,
      createQueryContext(Date.now()),
    );
    assert.ok(
      results.sections.every(
        (section) => !section.filePath.includes('2026-09-08'),
      ),
    );
    assert.ok(results.sections.length > 0);
  });

  test('returns nothing for a query that failed to parse', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('(tag:#a').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(results, { sections: [], tasks: [], files: [] });
  });
});

suite('Deckard search page state', () => {
  test('a search that is not one tag has no tag header', () => {
    const index = createIndex();
    const snapshot = createSearchPageSnapshot(
      index,
      createPreferences(),
      'tag = #risk/vendor OR tag = #project/atlas',
      { queryContext: createQueryContext(Date.now()), originQuery: '#project/atlas' },
    );

    assert.strictEqual(snapshot.tag, undefined);
    assert.strictEqual(snapshot.hub, undefined);
    assert.strictEqual(snapshot.originQuery, '#project/atlas');
  });

  test('a search of one tag is that tag\'s page, however it is written', () => {
    const index = createIndex();
    for (const text of ['#project/atlas', 'tag = #project/atlas', 'tag:#project/atlas']) {
      const snapshot = createSearchPageSnapshot(index, createPreferences(), text, { queryContext: createQueryContext(Date.now()) });
      assert.strictEqual(snapshot.tag?.key, '#project/atlas', text);
      assert.strictEqual(snapshot.query.text, text, 'the box keeps what was typed');
    }
    const narrowed = createSearchPageSnapshot(
      index,
      createPreferences(),
      '#project/atlas is:open',
      { queryContext: createQueryContext(Date.now()) },
    );
    assert.strictEqual(narrowed.tag, undefined, 'anything more is a search');
  });

  test('reads is:, has:, no:, and in: as shorthand conditions', () => {
    const conditions = (text: string) => {
      const parsed = parseQuery(text);
      assert.deepStrictEqual(parsed.diagnostics, [], text);
      const found: string[] = [];
      const visit = (node: typeof parsed.node): void => {
        if (!node) {
          return;
        }
        if (node.type === 'condition') {
          found.push(`${node.field} ${node.operator} ${node.value}`);
        } else if (node.type === 'not') {
          found.push('NOT');
          visit(node.child);
        } else {
          node.children.forEach(visit);
        }
      };
      visit(parsed.node);
      return found;
    };

    assert.deepStrictEqual(conditions('is:open'), ['is eq open']);
    assert.deepStrictEqual(conditions('is:todo'), ['is eq open']);
    assert.deepStrictEqual(conditions('has:due no:priority'), [
      'has eq due',
      'has neq priority',
    ]);
    assert.deepStrictEqual(conditions('-is:done'), ['NOT', 'is eq done']);
    assert.deepStrictEqual(conditions('in:./notes/work/'), ['in eq notes/work']);
  });

  test('rejects a shorthand value it does not know', () => {
    assert.match(parseQuery('is:maybe').diagnostics[0].message, /is: accepts/);
    assert.match(parseQuery('no:color').diagnostics[0].message, /has: and no: accept/);
  });

  test('writes shorthands back the way they are typed', () => {
    assert.strictEqual(
      formatQuery(parseQuery('is:open no:due in:notes #project/atlas').node),
      'is:open AND no:due AND in:notes AND tag = #project/atlas',
    );
    // The builder folds NOT into the operator, and still writes a shorthand.
    assert.strictEqual(
      fromBuilderTree(toBuilderTree(parseQuery('-is:open').node)),
      '-is:open',
    );
    assert.strictEqual(
      fromBuilderTree(toBuilderTree(parseQuery('NOT has:due').node)),
      'no:due',
    );
  });

  test('evaluates is:, has:, and no: against tasks and notes', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const index = createIndex();
    index.tasks.set('late', createTask({ id: 'late', dueAt: now - 2 * day }));
    index.tasks.set('soon', createTask({ id: 'soon', dueAt: now + 2 * day }));
    index.tasks.set('later', createTask({ id: 'later', dueAt: now + 20 * day }));
    const taskIds = (text: string) =>
      evaluateQuery(index, parseQuery(text).node, createQueryContext(Date.now())).tasks.map((task) => task.id);

    assert.deepStrictEqual(taskIds('is:open'), ['task-open', 'late', 'soon', 'later']);
    assert.deepStrictEqual(taskIds('is:done'), ['task-done']);
    assert.deepStrictEqual(taskIds('is:overdue'), ['late']);
    assert.deepStrictEqual(taskIds('is:due'), ['late', 'soon']);
    assert.deepStrictEqual(taskIds('has:due'), ['late', 'soon', 'later']);
    assert.deepStrictEqual(taskIds('no:due'), ['task-open', 'task-done']);

    // no:due answers for tasks only, as due = none does, rather than
    // listing every note that has no due date.
    assert.deepStrictEqual(evaluateQuery(index, parseQuery('no:due').node, createQueryContext(Date.now())).sections, []);
    const notes = evaluateQuery(index, parseQuery('is:note').node, createQueryContext(Date.now()));
    assert.strictEqual(notes.tasks.length, 0);
    assert.strictEqual(notes.sections.length, 5);
  });

  test('reads a week, a month, a weekday, or a day in words as a date', () => {
    for (const text of [
      'created = last-month',
      'due <= friday',
      'due <= "oct 3"',
      'due <= end-of-month',
      'created = 2026-08',
      'done >= "last friday"',
      'updated >= this-week',
    ]) {
      assert.deepStrictEqual(parseQuery(text).diagnostics, [], text);
    }
    const numeric = parseQuery('due = 10/3');
    assert.strictEqual(
      numeric.diagnostics[0]?.message,
      'due accepts a date such as 2026-09-13, friday, "oct 3", this-week, next-month, a window such as 7d, or none.',
      'a numeric date means different days on different machines',
    );
    assert.strictEqual(
      parseQuery('created = soon').diagnostics[0]?.message,
      'created accepts a date such as 2026-09-13, friday, this-week, last-month, 2026-08, or a window such as 30d.',
    );
  });

  test('refuses a day the calendar does not have, as it refuses any other malformed date', () => {
    for (const day of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-04-31', '2026-00-10', '2026-01-00']) {
      assert.strictEqual(
        parseQuery(`due = ${day}`).diagnostics[0]?.message,
        parseQuery('due = soon').diagnostics[0]?.message,
        day,
      );
      assert.strictEqual(
        parseQuery(`created = ${day}`).diagnostics[0]?.message,
        parseQuery('created = soon').diagnostics[0]?.message,
        day,
      );
      assert.strictEqual(resolveDateRange(day, Date.now(), 'past', 0), undefined, day);
    }
    assert.deepStrictEqual(parseQuery('due = 2028-02-29').diagnostics, [], 'a leap day is a day');
    assert.deepStrictEqual(parseQuery('due = 2026-12-31').diagnostics, []);
  });

  test('refuses a window or a day written with a minus sign, rather than reading it as a day ahead', () => {
    for (const value of ['-7d', '"-3-days"', '-friday']) {
      assert.strictEqual(
        parseQuery(`due = ${value}`).diagnostics[0]?.message,
        parseQuery('due = soon').diagnostics[0]?.message,
        value,
      );
      assert.strictEqual(
        parseQuery(`updated > ${value}`).diagnostics[0]?.message,
        parseQuery('updated > soon').diagnostics[0]?.message,
        value,
      );
    }
    // A plus sign says ahead, as it does in a date box, and dashes still stand for spaces.
    for (const value of ['+2w', '3-days-ago', 'next-friday']) {
      assert.deepStrictEqual(parseQuery(`due = ${value}`).diagnostics, [], value);
    }
  });

  test('takes "feb 29" as a date, since some years have it, and refuses a day no year has', () => {
    for (const text of ['due <= "feb 29"', 'due = "29 february"', 'created >= "feb 29"', 'done = "feb 29"']) {
      assert.deepStrictEqual(parseQuery(text).diagnostics, [], text);
    }
    assert.strictEqual(
      parseQuery('due <= "feb 30"').diagnostics[0]?.message,
      parseQuery('due = soon').diagnostics[0]?.message,
    );
    // In a leap year it is that year's leap day, read on the moment asked.
    const january2028 = new Date(2028, 0, 20, 12).getTime();
    const range = resolveDateRange('feb 29', january2028, 'future', 0);
    assert.strictEqual(range && formatIsoDate(range.start), '2028-02-29');
  });

  test('reads "feb 29" as the nearest leap day, however many years away', () => {
    // From October 2026 the next leap day is in 2028 and the last in 2024.
    const october2026 = new Date(2026, 9, 2, 12).getTime();
    const day = (direction: 'past' | 'future', now = october2026) => {
      const range = resolveDateRange('feb 29', now, direction, 0);
      return range && formatIsoDate(range.start);
    };
    assert.strictEqual(day('future'), '2028-02-29');
    assert.strictEqual(day('past'), '2024-02-29');
    assert.deepStrictEqual(
      evaluateQuery(
        buildWorkspaceIndex(
          new Map([['notes/a.md', parseMarkdown('notes/a.md', '- [ ] Spring 📅 2027-05-01\n')]]),
        ),
        parseQuery('due <= "feb 29"').node,
        createQueryContext(october2026),
      ).tasks.map((task) => task.title),
      ['Spring'],
    );
    // 2100 is no leap year, so from 2097 the next is eight years on.
    assert.strictEqual(day('future', new Date(2097, 0, 1, 12).getTime()), '2104-02-29');
    assert.strictEqual(day('past', new Date(2103, 11, 1, 12).getTime()), '2096-02-29');
  });

  test('a day ends at its next midnight, on a daylight-saving change as on any other', () => {
    // New York moves its clocks on 2026-03-08, a 23-hour day, and on
    // 2026-11-01, a 25-hour one.
    inTimeZone('America/New_York', () => {
      const now = new Date(2026, 0, 15, 12).getTime();
      for (const [day, next] of [['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02']]) {
        const range = resolveDateRange(day, now, 'future', 0);
        assert.strictEqual(range?.end, startOfDay(new Date(`${next}T12:00`).getTime()), day);
      }
      const index = buildWorkspaceIndex(
        new Map([['notes/a.md', parseMarkdown('notes/a.md', '- [ ] Spring 📅 2026-03-09\n- [ ] Fall 📅 2026-11-01\n')]]),
      );
      const titles = (text: string) =>
        evaluateQuery(index, parseQuery(text).node, createQueryContext(now)).tasks.map((task) => task.title);
      assert.deepStrictEqual(titles('due = 2026-03-08'), [], 'the next day is not this one');
      assert.deepStrictEqual(titles('due < 2026-03-09'), []);
      assert.deepStrictEqual(titles('due = 2026-11-01'), ['Fall']);
    });
  });

  test('counts named days and windows in calendar days, across a daylight-saving change', () => {
    // New York moves its clocks forward on Sunday 2026-03-08 and back on
    // Sunday 2026-11-01, so a day there is not always 24 hours.
    inTimeZone('America/New_York', () => {
      const midnight = (day: string) => startOfDay(new Date(`${day}T12:00`).getTime());
      const index = buildWorkspaceIndex(
        new Map([
          [
            'notes/a.md',
            parseMarkdown(
              'notes/a.md',
              [
                '- [ ] Sunday 📅 2026-03-08',
                '- [ ] Monday 📅 2026-03-09',
                '- [ ] Thursday 📅 2026-03-12',
                '- [ ] Starts Monday 🛫 2026-03-09',
                '- [ ] Fall 📅 2026-11-01',
                '',
              ].join('\n'),
            ),
          ],
        ]),
      );
      const titles = (text: string, now: number) =>
        evaluateQuery(index, parseQuery(text).node, createQueryContext(now)).tasks.map((task) => task.title);

      const springDay = new Date(2026, 2, 8, 9).getTime();
      assert.deepStrictEqual(titles('due = today', springDay), ['Sunday']);
      assert.deepStrictEqual(titles('is:today', springDay), ['Sunday']);
      assert.deepStrictEqual(titles('due = tomorrow', springDay), ['Monday']);
      assert.ok(!titles('is:available', springDay).includes('Starts Monday'), 'it starts tomorrow');

      const nov2 = new Date(2026, 10, 2, 12).getTime();
      assert.deepStrictEqual(titles('due = yesterday', nov2), ['Fall']);

      const march5 = new Date(2026, 2, 5, 12).getTime();
      assert.strictEqual(resolveDateRange('7d', march5, 'future', 0)?.end, midnight('2026-03-12'));
      assert.ok(!titles('due = 7d', march5).includes('Thursday'), 'seven days, not eight');
      assert.ok(!titles('is:due', march5).includes('Thursday'), 'seven days, not eight');
      const march10 = new Date(2026, 2, 10, 12).getTime();
      assert.strictEqual(resolveDateRange('7d', march10, 'past', 0)?.start, midnight('2026-03-04'));

      const due = buildSearchFacets(
        buildWorkspaceIndex(new Map()),
        {
          sections: [],
          files: [],
          tasks: [
            createTask({ id: 'a', dueAt: midnight('2026-03-05') }),
            createTask({ id: 'b', dueAt: midnight('2026-03-12') }),
          ],
        },
        '',
        { now: march5 },
      ).find((facet) => facet.id === 'due');
      assert.deepStrictEqual(
        due?.values.map((value) => [value.label, value.count]),
        [
          ['Next 7 days', 1],
          ['Later', 1],
        ],
        'the facet counts the days its clause finds',
      );
      const updated = buildSearchFacets(
        buildWorkspaceIndex(new Map()),
        {
          sections: [
            createSection({ id: 'old', updatedAt: new Date(2026, 2, 3, 23, 30).getTime() }),
            createSection({ id: 'new', updatedAt: new Date(2026, 2, 4, 9).getTime() }),
          ],
          files: [],
          tasks: [],
        },
        '',
        { now: march10 },
      ).find((facet) => facet.id === 'updated');
      assert.deepStrictEqual(
        updated?.values.map((value) => [value.label, value.count]),
        [
          ['Last 7 days', 1],
          ['1–4 weeks ago', 1],
        ],
      );
    });
  });

  test('resolves a week by the day it starts on, and a weekday by its direction', () => {
    // Friday 2026-09-25, noon.
    const now = new Date(2026, 8, 25, 12).getTime();
    const span = (value: string, direction: 'past' | 'future', weekStart: Weekday = 0) => {
      const range = resolveDateRange(value, now, direction, weekStart);
      return range && `${formatIsoDate(range.start)}..${formatIsoDate(range.end)}`;
    };
    assert.strictEqual(span('this-week', 'future'), '2026-09-20..2026-09-27');
    assert.strictEqual(span('this-week', 'future', 1), '2026-09-21..2026-09-28');
    assert.strictEqual(span('last-month', 'past'), '2026-08-01..2026-09-01');
    assert.strictEqual(span('next-week', 'future'), '2026-09-27..2026-10-04');
    assert.strictEqual(span('friday', 'past'), '2026-09-18..2026-09-19');
    assert.strictEqual(span('friday', 'future'), '2026-10-02..2026-10-03');
    assert.strictEqual(span('"last friday"'.replace(/"/g, ''), 'past'), '2026-09-18..2026-09-19');
    assert.strictEqual(span('end-of-month', 'future'), '2026-09-30..2026-10-01');
    assert.strictEqual(span('10/3', 'future'), undefined);
  });

  test('matches a whole week, and before the next one starts', () => {
    const day = 24 * 60 * 60 * 1000;
    const weekStart = startOfWeek(Date.now(), 0);
    const index = createIndex();
    index.tasks.set('first', createTask({ id: 'first', dueAt: weekStart + 12 * 60 * 60 * 1000 }));
    index.tasks.set('last', createTask({ id: 'last', dueAt: weekStart + 6 * day + 60 * 60 * 1000 }));
    index.tasks.set('next', createTask({ id: 'next', dueAt: weekStart + 7 * day + 60 * 60 * 1000 }));
    index.tasks.set('before', createTask({ id: 'before', dueAt: startOfDay(weekStart - day) }));
    const taskIds = (text: string) =>
      evaluateQuery(index, parseQuery(text).node, createQueryContext(Date.now())).tasks.map((task) => task.id);
    assert.deepStrictEqual(taskIds('due = this-week'), ['first', 'last']);
    assert.deepStrictEqual(taskIds('due < next-week'), ['first', 'last', 'before']);
    assert.deepStrictEqual(taskIds('due >= next-week'), ['next']);
  });

  test('Can start now switches a search to is:available and back', () => {
    assert.strictEqual(toggleAvailable('is:open'), 'is:available');
    assert.strictEqual(toggleAvailable('is:available'), 'is:open');
    assert.strictEqual(toggleAvailable('is:open #project/atlas'), 'is:available #project/atlas');
    assert.strictEqual(toggleAvailable('is:available #project/atlas'), 'is:open #project/atlas');
    assert.strictEqual(toggleAvailable('#project/atlas'), 'is:available #project/atlas');
    assert.strictEqual(toggleAvailable('#a OR #b'), 'is:available (#a OR #b)');
    assert.strictEqual(toggleAvailable(''), 'is:available');
    assert.strictEqual(hasAvailableTerm('#a is:available'), true);
    assert.strictEqual(hasAvailableTerm('is:open'), false);
  });

  test('matches in: against whole folders', () => {
    const index = createIndex();
    const sectionCount = (text: string) =>
      evaluateQuery(index, parseQuery(text).node, createQueryContext(Date.now())).sections.length;

    assert.strictEqual(sectionCount('in:notes'), 5);
    // A folder is matched whole, so a name that only starts the same way
    // does not count.
    assert.strictEqual(sectionCount('in:note'), 0);
    assert.strictEqual(sectionCount('-in:notes'), 0);
    assert.strictEqual(sectionCount('in:no*'), 5);
  });
});

/**
 * Minimal preferences for the state projections under test.
 */
function createPreferences(): PersistedPreferences {
  return {
    version: 1,
    favoriteTags: [],
    favoriteEntities: [],
    tagSortMode: 'alphabetical',
    entitySortMode: 'alphabetical',
    tagAccessOrder: [],
    tagAccessCounts: {},
    entityAccessOrder: [],
    entityAccessCounts: {},
    taskOrder: [],
    taskSortMode: 'rank',
    dashboardTaskColumns: 1,
    dashboardNoteColumns: 1,
    dashboardTagColumns: 1,
    dashboardViewState: {
      mode: 'home',
      tagSearchQuery: '',
    },
    taskBoardLayout: 'board',
    taskBoardGroup: 'status',
      renderMode: 'markdown',
      searchPreview: 'lines',
    tagOverviewSortMode: 'alphabetical',
    tagOverviewLayout: 'tabs',
  searchPageSize: 30,
    relatedNotesSortMode: 'newest',
    sectionAccessCounts: {},
    savedFilters: [],
    dashboardWidgets: [],
  };
}

/**
 * Builds a small, explicit index so query behavior is checked against known
 * membership rather than against whatever a parser run happens to produce.
 */
function createIndex(): WorkspaceIndex {
  const sections: Section[] = [
    createSection({
      id: 'atlas-ren',
      filePath: 'notes/2026-09-08.md',
      heading: 'Shutdown telemetry audit',
      tags: ['#project/atlas', '@ren'],
      rawContent: 'Ren will retain only the shutdown telemetry feed.',
    }),
    createSection({
      id: 'atlas-solo',
      filePath: 'notes/2026-09-09.md',
      heading: 'Atlas planning',
      tags: ['#project/atlas'],
      rawContent: 'Sequencing for the next milestone.',
    }),
    createSection({
      id: 'atlas-parent',
      filePath: 'notes/2026-09-10.md',
      heading: 'Atlas',
      tags: ['#project/atlas'],
      headingTags: [{ key: '#project/atlas', label: '#project/atlas' }],
      rawContent: '',
      bodyContent: '',
    }),
    createSection({
      id: 'atlas-child',
      filePath: 'notes/2026-09-10.md',
      heading: 'Check-in',
      tags: [],
      parentSectionId: 'atlas-parent',
      rawContent: 'Notes from the check-in.',
    }),
    createSection({
      id: 'vendor',
      filePath: 'notes/2026-09-11.md',
      heading: 'Vendor risk',
      tags: ['#risk/vendor'],
      rawContent: 'Documented the absence of an elevator service contract.',
    }),
  ];

  const tasks: Task[] = [
    createTask({
      id: 'task-open',
      filePath: 'notes/2026-09-08.md',
      title: 'Send the audit summary',
      tags: ['#project/atlas'],
      completed: false,
    }),
    createTask({
      id: 'task-done',
      filePath: 'notes/2026-09-08.md',
      title: 'Collect the telemetry export',
      tags: ['#project/atlas'],
      completed: true,
    }),
  ];

  const files: ParsedFile[] = [
    {
      filePath: 'notes/intro.md',
      content: '---\ntopics:\n  - intro\n---\nWelcome.',
      sections: [],
      tasks: [],
      frontmatterTags: [{ key: '#topic/intro', label: '#topic/intro' }],
      links: [],
    },
  ];

  const tags = new Map<string, TagInfo>();
  const addTag = (
    key: string,
    sectionIds: string[],
    taskIds: string[],
    filePaths: string[],
  ): void => {
    tags.set(key, {
      key,
      label: key,
      sectionIds,
      taskIds,
      filePaths,
      count: sectionIds.length + taskIds.length + filePaths.length,
      isFavorite: false,
    });
  };
  addTag(
    '#project/atlas',
    ['atlas-ren', 'atlas-solo', 'atlas-parent'],
    ['task-open', 'task-done'],
    [],
  );
  addTag('@ren', ['atlas-ren'], [], []);
  addTag('#risk/vendor', ['vendor'], [], []);
  addTag('#topic/intro', [], [], ['notes/intro.md']);

  return {
    files: new Map(files.map((file) => [file.filePath, file])),
    sections: new Map(sections.map((section) => [section.id, section])),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags,
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createSection(values: Partial<Section> & { id: string }): Section {
  return {
    filePath: 'notes/note.md',
    heading: '',
    headingLevel: 2,
    tags: [],
    tagLabels: {},
    links: [],
    rawContent: '',
    bodyContent: '',
    startLine: 1,
    endLine: 2,
    bodyEndLine: 2,
    ...values,
  };
}

function createTask(values: Partial<Task> & { id: string }): Task {
  return {
    filePath: 'notes/note.md',
    title: '',
    completed: false,
    tags: [],
    tagLabels: {},
    lineNumber: 1,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText: '- [ ] task',
    ...values,
  };
}

