import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import { parseQuery } from '../domain/query/queryParser';
import { parseWorkspaceQuery } from '../domain/types/typeQueryFields';
import { createQuerySuggestions } from '../ui/state/querySuggestions';
import { formatBuilderCondition, formatFieldValues, parseConditionText, valueContext } from '../webview/shared/queryText';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const index = typedWorkspace();

/** A query parsed with this workspace's types. */
function parseTyped(text: string): ReturnType<typeof parseQuery> {
  return parseWorkspaceQuery(index, text);
}

suite('Query language: completions and builder rows for type fields', () => {
  test('the page writes a type field\'s row as the host does', () => {
    const row = { field: 'tier', operator: 'eq', value: 'gold, silver', supported: true, text: '' };
    assert.strictEqual(formatBuilderCondition(row), 'tier = gold, silver');
    assert.strictEqual(formatBuilderCondition({ ...row, field: 'owns', value: 'Bond trading, "Smith, Jones"' }), 'owns = "Bond trading", "Smith, Jones"');
    assert.strictEqual(formatFieldValues('[[RFQ outage]]'), '[[RFQ outage]]');
    const aliases = { tier: 'tier', 'team.lead': 'team.lead', 'on-call': 'on-call' };
    assert.deepStrictEqual(parseConditionText('team.lead = @dana', aliases), { field: 'team.lead', operator: 'eq', value: '@dana', supported: true, text: '' });
    assert.deepStrictEqual(parseConditionText('tier = gold, silver', aliases).value, 'gold, silver');
    assert.deepStrictEqual(valueContext('type = team on-call = pr', aliases), { field: 'on-call', token: 'pr' });
  });

  test('after a type condition, offers its fields, those through each relation, then the built-ins', () => {
    const suggestions = createQuerySuggestions(index, [], createQueryContext(now), parseTyped('type = team').node);
    const groups = [...new Set(suggestions.fields.map((field) => field.group))];
    assert.deepStrictEqual(groups.slice(0, 3), ['Team', 'Through lead', 'Through owns']);
    assert.strictEqual(groups[groups.length - 1], 'Built in');
    const team = suggestions.fields.filter((field) => field.group === 'Team').map((field) => field.value);
    assert.deepStrictEqual(team.slice(0, 6), ['lead', 'owns', 'tier', 'headcount', 'on-call', 'field.status']);
    assert.ok(team.includes('members'), 'the reverse of a person\'s team');
    assert.ok(team.includes('open-tasks'));
    assert.ok(suggestions.fields.some((field) => field.value === 'lead.email' && field.group === 'Through lead'));
    assert.ok(suggestions.fields.some((field) => field.value === 'type' && field.group === 'Built in'));
    // Values by kind.
    assert.deepStrictEqual(suggestions.values.tier?.map((value) => value.value), ['gold', 'silver', 'bronze']);
    assert.deepStrictEqual(suggestions.values['lead.remote']?.map((value) => value.value), ['true', 'false']);
    assert.deepStrictEqual(suggestions.values.lead?.map((value) => value.value), ['@dana', '@omar', '@priya']);
    assert.deepStrictEqual(suggestions.values.lead?.[0], { value: '@dana', label: 'Dana Whitfield', detail: 'Person · @dana' });
    assert.deepStrictEqual(suggestions.values.type?.map((value) => value.value), ['area', 'incident', 'person', 'team']);
    assert.deepStrictEqual(suggestions.operators.headcount, ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
    assert.deepStrictEqual(suggestions.operators.tier, ['eq', 'neq']);
    assert.strictEqual(suggestions.aliases['lead.email'], 'lead.email');
    assert.strictEqual(suggestions.aliases.type, 'type');
    assert.ok(suggestions.values.has?.some((value) => value.value === 'on-call'));
    assert.ok(suggestions.conditions.some((condition) => condition.value === 'type = team'));
  });

  test('offers a field the search already uses, and only built-ins without a type', () => {
    const used = createQuerySuggestions(index, [], createQueryContext(now), parseTyped('team.lead = @dana').node);
    assert.deepStrictEqual(used.fields.filter((field) => field.group !== 'Built in').map((field) => [field.value, field.group]), [['team.lead', 'In this search']]);
    const none = createQuerySuggestions(indexOf({ 'notes/a.md': '# A' }), [], createQueryContext(now));
    assert.ok(none.fields.every((field) => field.group === undefined));
    assert.ok(!none.fields.some((field) => field.value === 'type'));
    assert.strictEqual(none.aliases.type, 'kind');
  });
});
