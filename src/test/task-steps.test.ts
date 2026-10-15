import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import {
  cleanStepText,
  describeStepParts,
  describeSteps,
  findStepFamily,
  foldSteps,
  formatStepLines,
  isPlainStep,
  parseSuggestedSteps,
  planStepInsertion,
  resetStepLine,
  splitTypedSteps,
} from '../domain/markdown/taskSteps';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { Task } from '../domain/model';
import { readCompletionFamily } from '../domain/tasks/taskLines';
import { DEFAULT_TASK_STATUSES } from '../domain/tasks/taskStatuses';
import { toggleTaskLines } from '../domain/tasks/toggleLines';

function tasksOf(markdown: string): Task[] {
  return parseMarkdown('notes/plan.md', markdown).tasks;
}

function titled(tasks: Task[], title: string): Task {
  const task = tasks.find((candidate) => candidate.title === title);
  assert.ok(task, title);
  return task;
}

suite('Task steps', () => {
  suite('the parser', () => {
    test('links a checkbox to the task it is indented under, with two spaces, four, or a tab', () => {
      ['  ', '    ', '\t'].forEach((indent) => {
        const tasks = tasksOf(`- [ ] Plan the offsite\n${indent}- [x] Book the venue\n${indent}- [ ] Draft the email`);
        const parent = titled(tasks, 'Plan the offsite');
        assert.strictEqual(titled(tasks, 'Book the venue').parentTaskId, parent.id, JSON.stringify(indent));
        assert.strictEqual(titled(tasks, 'Draft the email').parentTaskId, parent.id);
        assert.deepStrictEqual(parent.steps, {
          ids: [titled(tasks, 'Book the venue').id, titled(tasks, 'Draft the email').id],
          total: 2,
          done: 1,
          next: 'Draft the email',
        });
        assert.strictEqual(parent.parentTaskId, undefined);
      });
    });

    test('keeps the parent across a blank line and a continuation line', () => {
      const tasks = tasksOf('- [ ] Plan\n  more words about it\n\n  - [ ] Step one');
      assert.strictEqual(titled(tasks, 'Step one').parentTaskId, titled(tasks, 'Plan').id);
    });

    test('a heading, a fence, and an unindented paragraph end the list', () => {
      ['# Heading', '```\ncode\n```', 'A paragraph.'].forEach((between) => {
        const tasks = tasksOf(`- [ ] Plan\n${between}\n  - [ ] Step one`);
        assert.strictEqual(titled(tasks, 'Step one').parentTaskId, undefined, between);
        assert.strictEqual(titled(tasks, 'Plan').steps, undefined, between);
      });
    });

    test('a checkbox under a plain bullet under a task is not a step', () => {
      const tasks = tasksOf('- [ ] Plan\n  - Notes\n    - [ ] Deep');
      assert.strictEqual(titled(tasks, 'Deep').parentTaskId, undefined);
      assert.strictEqual(titled(tasks, 'Plan').steps, undefined);
    });

    test('a task counts only its own steps, not their steps', () => {
      const tasks = tasksOf('- [ ] Plan\n  - [ ] Book\n    - [x] Call the venue\n    - [ ] Pay\n  - [x] Email');
      const plan = titled(tasks, 'Plan');
      const book = titled(tasks, 'Book');
      assert.strictEqual(plan.steps?.total, 2);
      assert.strictEqual(plan.steps?.done, 1);
      assert.strictEqual(plan.steps?.next, 'Book');
      assert.strictEqual(book.parentTaskId, plan.id);
      assert.strictEqual(book.steps?.total, 2);
      assert.strictEqual(titled(tasks, 'Pay').parentTaskId, book.id);
    });

    test('a note with no nesting parses to the tasks it always did', () => {
      const tasks = tasksOf('# Plan\n- [ ] One\n- [x] Two\n\n* [ ] Three');
      tasks.forEach((task) => {
        assert.strictEqual('parentTaskId' in task, false);
        assert.strictEqual('steps' in task, false);
      });
    });

    test('steps inside a fence are not tasks at all', () => {
      const tasks = tasksOf('- [ ] Plan\n  ```\n  - [ ] not a step\n  ```');
      assert.deepStrictEqual(tasks.map((task) => task.title), ['Plan']);
    });
  });

  suite('the wording', () => {
    test('says how far along and what is next', () => {
      assert.strictEqual(
        describeSteps({ ids: [], total: 5, done: 2, next: 'Draft the email #project/atlas' }),
        'Steps 2/5 done (40%) · next: Draft the email',
      );
      assert.strictEqual(
        describeSteps({ ids: [], total: 1, done: 0, next: 'Draft the email' }),
        'Steps 0/1 done (0%) · next: Draft the email',
      );
      assert.strictEqual(describeSteps({ ids: [], total: 5, done: 5 }), 'Steps 5/5 done (100%)');
      assert.strictEqual(describeSteps({ ids: [], total: 1, done: 1 }), 'Steps 1/1 done (100%)');
      assert.deepStrictEqual(describeStepParts({ ids: [], total: 3, done: 1, next: 'Pay' }), {
        label: 'Steps 1/3 done (33%)',
        next: 'Pay',
      });
    });
  });

  suite('folding', () => {
    const tasks = tasksOf([
      '- [ ] Plan',
      '  - [ ] Plain step',
      '  - [ ] Dated step 📅 2026-10-09',
      '  - [ ] Urgent step ⏫',
      '  - [ ] Dana step 👤 @dana',
      '  - [ ] Tagged step #status/doing',
      '- [x] Done task',
      '  - [ ] Step of a done task',
    ].join('\n'));

    test('a step with its own date, priority, person, or tag is not plain', () => {
      assert.strictEqual(isPlainStep(titled(tasks, 'Plain step')), true);
      ['Dated step', 'Urgent step', 'Dana step', 'Tagged step #status/doing'].forEach((title) =>
        assert.strictEqual(isPlainStep(titled(tasks, title)), false, title),
      );
      assert.strictEqual(isPlainStep(titled(tasks, 'Plan')), false);
    });

    test('plain steps fold into a listed task; others stay', () => {
      const open = tasks.filter((task) => !task.completed);
      assert.deepStrictEqual(foldSteps(open).map((task) => task.title), [
        'Plan',
        'Dated step',
        'Urgent step',
        'Dana step',
        'Tagged step #status/doing',
        'Step of a done task',
      ]);
    });
  });

  suite('writing steps', () => {
    test('finds a task line’s parent and its own steps', () => {
      const lines = ['- [ ] Plan', '  - [ ] One', '    - [ ] Deep', '  - Note', '  - [x] Two', '- [ ] Next'];
      assert.deepStrictEqual(findStepFamily(lines, 0), { steps: [1, 4] });
      assert.deepStrictEqual(findStepFamily(lines, 1), { parent: 0, steps: [2] });
      assert.deepStrictEqual(findStepFamily(lines, 5), { steps: [] });
    });

    test('a question under a task is no step, and a task under a question has no task above it', () => {
      const lines = ['- [ ] Prepare the review', '  - [?] Who signs off on the budget?', '    - [ ] Ask Priya', '  - [ ] Book the room'];
      assert.deepStrictEqual(findStepFamily(lines, 0), { steps: [3] });
      assert.deepStrictEqual(findStepFamily(lines, 2), { steps: [] });
      // With `?` given to a status of the reader's own, the line is a task again.
      const own = [...DEFAULT_TASK_STATUSES.filter((status) => status.symbol !== '?'), { symbol: '?', name: 'Unsure', type: 'todo' as const }];
      assert.deepStrictEqual(findStepFamily(lines, 0, own), { steps: [1, 3] });
      // A line of a status that is no task is no step either.
      const noted = [...DEFAULT_TASK_STATUSES, { symbol: 'n', name: 'Note', type: 'nonTask' as const }];
      assert.deepStrictEqual(findStepFamily(['- [ ] Plan', '  - [n] Context', '  - [ ] One'], 0, noted), { steps: [2] });
    });

    test('completing a task with a question under it finds no open step, and the question is no task\'s last step', () => {
      const lines = ['# N', '- [ ] Prepare the review', '  - [?] Who signs off on the budget?', '    - [ ] Ask Priya', ''];
      assert.strictEqual(readCompletionFamily(lines, 1, '- [x] Prepare the review ✅ 2026-10-14').openSteps, 0);
      assert.strictEqual(readCompletionFamily(lines, 3, '    - [x] Ask Priya ✅ 2026-10-14').lastStepOf, undefined);
    });

    test('a repeating task\'s next occurrence takes its steps and leaves a question under it where it is', () => {
      const documentLines = ['# N', '- [ ] Weekly sync 🔁 every week 📅 2026-10-14', '  - [?] Ask about the budget?', '  - [x] Send the notes ✅ 2026-10-14', ''];
      const result = toggleTaskLines([{ line: 1, text: documentLines[1] }], new Date(2026, 9, 14, 12).getTime(), {
        format: 'emoji',
        eol: '\n',
        documentLines,
      });
      assert.deepStrictEqual(result.lines[0].after.split('\n').slice(0, 2), [
        '- [ ] Weekly sync 🔁 every week 📅 2026-10-21',
        '  - [ ] Send the notes',
      ]);
      assert.ok(!result.lines[0].after.includes('Ask about the budget'), result.lines[0].after);
    });

    test('goes after what is under the task, before the blank lines after it', () => {
      const lines = ['- [ ] Plan', '  - [ ] One', '    words', '', '- [ ] Next'];
      assert.deepStrictEqual(planStepInsertion(lines, 0), { afterLine: 2, indent: '  ', marker: '-' });
      assert.deepStrictEqual(planStepInsertion(['* [ ] Plan', '', 'Prose'], 0), {
        afterLine: 0,
        indent: '  ',
        marker: '*',
      });
      assert.strictEqual(planStepInsertion(['- [ ] Last line'], 0).afterLine, 0);
    });

    test('indents as the first step, then as the note nests, then two spaces in', () => {
      assert.strictEqual(planStepInsertion(['- [ ] Plan', '    - [ ] One'], 0).indent, '    ');
      assert.strictEqual(planStepInsertion(['- [ ] Plan', '- Other', '\t- nested'], 0).indent, '\t');
      assert.strictEqual(planStepInsertion(['  - [ ] Plan'], 0).indent, '    ');
      assert.strictEqual(planStepInsertion(['\t- [ ] Plan'], 0).indent, '\t\t');
    });

    test('writes unchecked lines with the task’s marker', () => {
      assert.deepStrictEqual(formatStepLines(['Book', 'Email'], '  ', '+'), ['  + [ ] Book', '  + [ ] Email']);
    });

    test('tidies typed and suggested steps', () => {
      assert.strictEqual(cleanStepText('- [ ] Call   Dana'), 'Call Dana');
      assert.strictEqual(cleanStepText('2. Book it'), 'Book it');
      assert.strictEqual(cleanStepText('-5 degrees check'), '-5 degrees check');
      assert.deepStrictEqual(splitTypedSteps('One\n\n- Two\r\n  '), ['One', 'Two']);
      const reply = [
        'Here are the steps:',
        '1. Pick a date',
        '- Book the venue',
        '* [ ] Send the invite',
        '',
        'x'.repeat(200),
        ...Array.from({ length: 12 }, (_, index) => `Step ${index}`),
      ].join('\n');
      const steps = parseSuggestedSteps(reply);
      assert.strictEqual(steps.length, 10);
      assert.deepStrictEqual(steps.slice(0, 3), ['Pick a date', 'Book the venue', 'Send the invite']);
      assert.strictEqual(steps[3].length, 120);
      assert.ok(steps[3].endsWith('…'));
    });

    test('resets a step for the next occurrence', () => {
      assert.strictEqual(resetStepLine('  - [x] Book the venue ✅ 2026-09-20'), '  - [ ] Book the venue');
      assert.strictEqual(
        resetStepLine('  - [x] Book the venue [completion:: 2026-09-20]'),
        '  - [ ] Book the venue',
      );
      assert.strictEqual(resetStepLine('  - [ ] Already open 📅 2026-10-01'), '  - [ ] Already open 📅 2026-10-01');
    });
  });

  suite('searching', () => {
    const files = new Map([
      ['notes/plan.md', parseMarkdown('notes/plan.md', '- [ ] Plan\n  - [ ] Book\n- [ ] Alone')],
    ]);
    const index = buildWorkspaceIndex(files);
    const titles = (query: string): string[] => {
      const parsed = parseQuery(query);
      assert.deepStrictEqual(parsed.diagnostics.filter((item) => item.severity === 'error'), [], query);
      return evaluateQuery(index, parsed.node, createQueryContext(Date.now())).tasks.map((task) => task.title).sort();
    };

    test('is:step, has:steps, and no:steps, with their other spellings', () => {
      assert.deepStrictEqual(titles('is:step'), ['Book']);
      assert.deepStrictEqual(titles('is:subtask'), ['Book']);
      assert.deepStrictEqual(titles('is:task -is:step'), ['Alone', 'Plan']);
      assert.deepStrictEqual(titles('has:steps'), ['Plan']);
      assert.deepStrictEqual(titles('has:subtasks'), ['Plan']);
      assert.deepStrictEqual(titles('no:steps'), ['Alone', 'Book']);
    });

    test('the errors list the new values', () => {
      assert.match(parseQuery('is:stepz').diagnostics[0].message, /parked, step, question, answered, or unanswered — not "stepz"/);
      assert.match(parseQuery('has:stepz').diagnostics[0].message, /dependsOn, or steps — not "stepz"/);
    });
  });
});
