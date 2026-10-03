import * as assert from 'assert';

import { describeRepeatRuleProblem, findRepeatRuleProblems } from '../domain/markdown/repeatRuleProblems';
import { parseRecurrence, suggestRecurrence } from '../domain/markdown/recurrence';

suite('Repeat rule problems', () => {
  test('suggests the nearest rules Deckard can read', () => {
    assert.strictEqual(suggestRecurrence('every tuesdya')[0], 'every tuesday');
    assert.strictEqual(suggestRecurrence('weekly')[0], 'every week');
    assert.strictEqual(suggestRecurrence('biweekly')[0], 'every 2 weeks');
    assert.strictEqual(suggestRecurrence('tuesday')[0], 'every tuesday');
    assert.strictEqual(suggestRecurrence('every mnth when done')[0], 'every month when done');
    assert.deepStrictEqual(suggestRecurrence('whenever'), []);
    assert.deepStrictEqual(suggestRecurrence('every week'), [], 'a rule it reads needs nothing');
    for (const rule of ['weekly', 'weekends', 'evry wek', 'every month on the scond tuesday']) {
      const suggestions = suggestRecurrence(rule);
      assert.ok(suggestions.length <= 3, rule);
      assert.ok(suggestions.every((suggestion) => parseRecurrence(suggestion)), rule);
    }
  });

  test('marks the rule on an open task only, over the rule\'s own text', () => {
    const lines = [
      '- [ ] Water plants 🔁 every tuesdya 📅 2026-09-29',
      '- [x] Done 🔁 whenever',
      '- [ ] Fine 🔁 every week',
      '- [ ] Dataview [repeat:: whenever]',
      '```',
      '- [ ] In code 🔁 whenever',
      '```',
    ];
    const problems = findRepeatRuleProblems(lines);
    assert.deepStrictEqual(
      problems.map((problem) => [problem.line, lines[problem.line].slice(problem.start, problem.end)]),
      [
        [0, 'every tuesdya'],
        [3, 'whenever'],
      ],
    );
    assert.strictEqual(
      describeRepeatRuleProblem(problems[0]),
      'Deckard cannot read the repeat rule "every tuesdya", so completing this task will not start the next one. Try "every tuesday".',
    );
    assert.strictEqual(
      describeRepeatRuleProblem(problems[1]),
      'Deckard cannot read the repeat rule "whenever", so completing this task will not start the next one. Write a rule such as "every week", "every month on the 15th", or "every weekday".',
    );
  });

  test('leaves front matter alone', () => {
    const lines = ['---', 'rule: - [ ] Not a task 🔁 whenever', '---', '- [ ] Real 🔁 whenever'];
    assert.deepStrictEqual(findRepeatRuleProblems(lines).map((problem) => problem.line), [3]);
  });
});
