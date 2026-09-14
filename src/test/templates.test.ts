import * as assert from 'assert';

import {
  fillTemplate,
  findTemplatePrompts,
  getTemplateVariables,
} from '../ui/commands/templates';

suite('Note templates', () => {
  test('asks each question a template holds once, in order', () => {
    assert.deepStrictEqual(
      findTemplatePrompts(
        '# {title}\nFor {ask:Client}, owned by {ask: Owner }.\nBilled to {ask:Client}. {ask:}',
      ),
      ['Client', 'Owner'],
    );
  });

  test('fills variables and answers, and leaves unknown placeholders', () => {
    const answers = new Map([
      ['Client', 'Harbor Clinic'],
      ['Owner', 'a note about {date}'],
    ]);
    assert.strictEqual(
      fillTemplate(
        '# {title}\n{date} {time}\nFor {ask:Client}; {ask: Owner }. {other} {ask:Missing}',
        { title: 'Kickoff', date: '2026-09-13', time: '09:05' },
        answers,
      ),
      '# Kickoff\n2026-09-13 09:05\nFor Harbor Clinic; a note about {date}. {other} {ask:Missing}',
    );
    assert.strictEqual(
      fillTemplate('{constructor} {toString}', {}),
      '{constructor} {toString}',
      'only the variables given are filled',
    );
  });

  test('gives every template the title, local date, and time', () => {
    assert.deepStrictEqual(getTemplateVariables('Kickoff', new Date(2026, 8, 3, 9, 5)), {
      title: 'Kickoff',
      date: '2026-09-03',
      time: '09:05',
    });
  });
});
