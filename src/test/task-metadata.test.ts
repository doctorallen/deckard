import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import {
  createNextOccurrence,
  formatIsoDate,
  parseRecurrence,
  parseTaskMetadata,
  setTaskLineCompletion,
} from '../core/markdown/taskMetadata';

const at = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

suite('Obsidian Tasks metadata', () => {
  test('reads every marker and leaves a clean title', () => {
    const { metadata, title } = parseTaskMetadata(
      'Send proposal 📅 2026-09-20 ⏳ 2026-09-18 🛫 2026-09-15 ➕ 2026-09-01 🔁 every week ⏫ 🆔 a1 ⛔ b2, c3 #project/atlas',
    );
    assert.strictEqual(title, 'Send proposal #project/atlas');
    assert.deepStrictEqual(metadata, {
      due: '2026-09-20',
      scheduled: '2026-09-18',
      start: '2026-09-15',
      created: '2026-09-01',
      priority: 'high',
      recurrence: 'every week',
      id: 'a1',
      dependsOn: ['b2', 'c3'],
    });
  });

  test('accepts the alternative emoji and variation selectors', () => {
    const { metadata, title } = parseTaskMetadata(
      'Plan 🗓\uFE0F 2026-09-20 ⌛ 2026-09-18 🔺\uFE0F',
    );
    assert.strictEqual(title, 'Plan');
    assert.strictEqual(
      parseTaskMetadata('Circulate triggers 📅2026-09-12 ^triggers').title,
      'Circulate triggers',
    );
    assert.strictEqual(metadata.due, '2026-09-20');
    assert.strictEqual(metadata.scheduled, '2026-09-18');
    assert.strictEqual(metadata.priority, 'highest');
  });

  test('parses task metadata without mistaking a done date for a due date', () => {
    const parsed = parseMarkdown(
      'tasks.md',
      [
        '- [x] Ship the release ✅ 2026-09-10',
        '- [ ] Call Ren 📅 2026-09-20 by 2026-09-30 🔽 🔁 every month',
        '- [ ] Draft by 2026-09-12',
      ].join('\n'),
    );
    const [shipped, call, draft] = parsed.tasks;

    assert.strictEqual(shipped.title, 'Ship the release');
    assert.strictEqual(shipped.dueText, undefined);
    assert.strictEqual(shipped.doneAt, at(2026, 9, 10));
    // The 📅 date wins over a date written in the sentence.
    assert.strictEqual(call.dueText, '2026-09-20');
    assert.strictEqual(call.title, 'Call Ren by 2026-09-30');
    assert.strictEqual(call.priority, 'low');
    assert.strictEqual(call.recurrence, 'every month');
    assert.strictEqual(draft.dueText, '2026-09-12');
    assert.strictEqual('priority' in draft, false);
  });

  test('adds a done date on completion and removes it on reopening', () => {
    assert.strictEqual(
      setTaskLineCompletion('- [ ] Ship 📅 2026-09-20', 3, true, '2026-09-13'),
      '- [x] Ship 📅 2026-09-20 ✅ 2026-09-13',
    );
    assert.strictEqual(
      setTaskLineCompletion('  * [ ] Ship ^ab12', 5, true, '2026-09-13'),
      '  * [x] Ship ✅ 2026-09-13 ^ab12',
    );
    assert.strictEqual(
      setTaskLineCompletion('- [x] Ship ✅ 2026-09-10', 3, true, '2026-09-13'),
      '- [x] Ship ✅ 2026-09-10',
    );
    assert.strictEqual(
      setTaskLineCompletion('- [x] Ship ✅ 2026-09-10 #a', 3, false, '2026-09-13'),
      '- [ ] Ship #a',
    );
    assert.strictEqual(
      setTaskLineCompletion('- [ ] Ship', 3, true, undefined),
      '- [x] Ship',
    );
  });

  test('reads the repeat rules Tasks writes', () => {
    const next = (rule: string, from: number): string => {
      const recurrence = parseRecurrence(rule);
      assert.ok(recurrence, rule);
      return formatIsoDate(recurrence.next(from));
    };

    assert.strictEqual(next('every day', at(2026, 9, 13)), '2026-09-14');
    assert.strictEqual(next('every 2 weeks', at(2026, 9, 13)), '2026-09-27');
    assert.strictEqual(next('every month', at(2026, 1, 31)), '2026-02-28');
    assert.strictEqual(next('every year', at(2024, 2, 29)), '2025-02-28');
    // 2026-09-11 is a Friday.
    assert.strictEqual(next('every weekday', at(2026, 9, 11)), '2026-09-14');
    assert.strictEqual(next('every Tuesday', at(2026, 9, 13)), '2026-09-15');
    assert.strictEqual(
      next('every week on Monday, Thursday', at(2026, 9, 14)),
      '2026-09-17',
    );
    assert.strictEqual(
      next('every month on the 15th', at(2026, 9, 20)),
      '2026-10-15',
    );
    assert.strictEqual(
      next('every month on the last', at(2026, 2, 3)),
      '2026-02-28',
    );
    assert.strictEqual(parseRecurrence('every week when done')?.whenDone, true);
    assert.strictEqual(parseRecurrence('every full moon'), undefined);
  });

  test('writes the next occurrence of a recurring task', () => {
    const today = at(2026, 9, 13);

    assert.strictEqual(
      createNextOccurrence(
        '- [ ] Review 📅 2026-09-10 ⏳ 2026-09-08 🔁 every week 🆔 r1 ✅ 2026-09-12 ^blk',
        3,
        today,
      ),
      '- [ ] Review 📅 2026-09-17 ⏳ 2026-09-15 🔁 every week',
    );
    assert.strictEqual(
      createNextOccurrence(
        '- [ ] Water plants 📅 2026-09-01 🔁 every 3 days when done',
        3,
        today,
      ),
      '- [ ] Water plants 📅 2026-09-16 🔁 every 3 days when done',
    );
    assert.strictEqual(createNextOccurrence('- [ ] Plain task', 3, today), undefined);
    assert.strictEqual(
      createNextOccurrence('- [ ] Odd 🔁 every full moon', 3, today),
      undefined,
    );
  });

  test('reads the Dataview format in square or round brackets', () => {
    const { metadata, title, format } = parseTaskMetadata(
      'Send proposal [due:: 2026-09-20] (scheduled:: 2026-09-18) [priority:: high] [repeat:: every week] [id:: a1] [dependsOn:: b2, c3] [owner:: Ren] #project/atlas',
    );
    // A Dataview field Tasks does not define stays part of the title.
    assert.strictEqual(title, 'Send proposal [owner:: Ren] #project/atlas');
    assert.strictEqual(format, 'dataview');
    assert.deepStrictEqual(metadata, {
      due: '2026-09-20',
      scheduled: '2026-09-18',
      priority: 'high',
      recurrence: 'every week',
      id: 'a1',
      dependsOn: ['b2', 'c3'],
    });

    const mixed = parseTaskMetadata('Ship 📅 2026-09-20 [priority:: low]');
    assert.strictEqual(mixed.format, 'emoji');
    assert.strictEqual(mixed.metadata.priority, 'low');
    assert.strictEqual(parseTaskMetadata('Plain task').format, undefined);
  });

  test('writes the done date in the format the task already uses', () => {
    assert.strictEqual(
      setTaskLineCompletion('- [ ] Ship [due:: 2026-09-20]', 3, true, '2026-09-13'),
      '- [x] Ship [due:: 2026-09-20] [completion:: 2026-09-13]',
    );
    assert.strictEqual(
      setTaskLineCompletion('- [ ] Ship', 3, true, '2026-09-13', 'dataview'),
      '- [x] Ship [completion:: 2026-09-13]',
    );
    assert.strictEqual(
      setTaskLineCompletion('- [ ] Ship 📅 2026-09-20', 3, true, '2026-09-13', 'dataview'),
      '- [x] Ship 📅 2026-09-20 ✅ 2026-09-13',
    );
    assert.strictEqual(
      setTaskLineCompletion('- [x] Ship (completion:: 2026-09-10)', 3, false),
      '- [ ] Ship',
    );
  });

  test('repeats a Dataview-format task', () => {
    assert.strictEqual(
      createNextOccurrence(
        '- [ ] Review [due:: 2026-09-10] [repeat:: every week] [id:: r1] [completion:: 2026-09-12]',
        3,
        at(2026, 9, 13),
      ),
      '- [ ] Review [due:: 2026-09-17] [repeat:: every week]',
    );
  });
});
