import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import {
  createNextOccurrence,
  formatIsoDate,
  parseRecurrence,
  parseTaskMetadata,
  PROJECTED_REPEATS,
  projectRepeats,
  setTaskAssignee,
  setTaskDate,
  setTaskLineCompletion,
  setTaskPriority,
  writeCompletion,
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

  test('reads every other, nth weekdays, quarters, and weekends', () => {
    const next = (rule: string, from: number): string => {
      const recurrence = parseRecurrence(rule);
      assert.ok(recurrence, rule);
      return formatIsoDate(recurrence.next(from));
    };
    // 2026-09-25 is a Friday.
    const friday = at(2026, 9, 25);
    assert.strictEqual(next('every other week', friday), '2026-10-09');
    assert.strictEqual(next('every other day', friday), '2026-09-27');
    assert.strictEqual(next('every month on the second tuesday', friday), '2026-10-13');
    assert.strictEqual(next('every month on the 2nd Tuesday', friday), '2026-10-13');
    assert.strictEqual(next('every month on the last friday', friday), '2026-10-30');
    assert.strictEqual(next('every quarter', friday), '2026-12-25');
    assert.strictEqual(next('every 2 quarters', friday), '2027-03-25');
    assert.strictEqual(next('every weekend', friday), '2026-09-26');
    assert.strictEqual(next('every weekend', at(2026, 9, 26)), '2026-09-27');
    // Weeks start on Monday, as Tasks counts them.
    assert.strictEqual(next('every 2 weeks on monday, thursday', at(2026, 9, 28)), '2026-10-01');
    assert.strictEqual(next('every 2 weeks on monday, thursday', at(2026, 10, 1)), '2026-10-12');
    assert.strictEqual(next('every other tuesday', friday), '2026-10-06');
    // November and December 2026 have four Fridays each.
    assert.strictEqual(next('every month on the fifth friday', at(2026, 10, 30)), '2027-01-29');
    assert.strictEqual(parseRecurrence('every other tuesday when done')?.whenDone, true);
    // The rules Tasks writes read as they did.
    assert.strictEqual(next('every 2 weeks', at(2026, 9, 13)), '2026-09-27');
    assert.strictEqual(next('every Tuesday', at(2026, 9, 13)), '2026-09-15');
    assert.strictEqual(parseRecurrence('every other'), undefined);
    assert.strictEqual(parseRecurrence('every month on the sixth friday'), undefined);
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

  test('a completion writes the next occurrence above the completed line', () => {
    const today = at(2026, 9, 13);
    const weekly = '- [x] Review 📅 2026-09-10 🔁 every week ✅ 2026-09-13';
    assert.deepStrictEqual(writeCompletion(weekly, 3, today, '\n'), {
      text: `- [ ] Review 📅 2026-09-17 🔁 every week\n${weekly}`,
      next: '- [ ] Review 📅 2026-09-17 🔁 every week',
    });
    assert.strictEqual(
      writeCompletion(weekly, 3, today, '\r\n').text,
      `- [ ] Review 📅 2026-09-17 🔁 every week\r\n${weekly}`,
      'in the line ending the note uses',
    );
    assert.deepStrictEqual(writeCompletion('- [x] Plain task', 3, today, '\n'), {
      text: '- [x] Plain task',
    });
    assert.deepStrictEqual(
      writeCompletion('- [x] Odd 🔁 every blue moon', 3, today, '\n'),
      { text: '- [x] Odd 🔁 every blue moon', unreadRule: 'every blue moon' },
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

  test('writes who a task is for, and leaves the words alone', () => {
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase the contractor ⏫ 📅 2026-09-25', 3, '@dana'),
      '- [ ] Chase the contractor ⏫ 📅 2026-09-25 👤 @dana',
    );
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase it @dana with @ren-kade', 3, '@mara-vale'),
      '- [ ] Chase it @dana with @ren-kade 👤 @mara-vale',
      'a person in the sentence was mentioned, and stays mentioned',
    );
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase it 👤 @dana 📅 2026-09-25', 3, '@ren-kade'),
      '- [ ] Chase it 📅 2026-09-25 👤 @ren-kade',
      'the field it had is replaced, not repeated',
    );
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase it 🧑 @dana', 3, undefined),
      '- [ ] Chase it',
      'either marker is read, and nobody clears it',
    );
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase it [due:: 2026-09-25]', 3, '@dana'),
      '- [ ] Chase it [due:: 2026-09-25] [assignee:: @dana]',
      'the line keeps the format it is written in',
    );
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase it [assignee:: @dana]', 3, undefined),
      '- [ ] Chase it',
    );
    assert.strictEqual(
      setTaskAssignee('- [ ] Chase it 📅 2026-09-25 ^chase', 3, '@dana'),
      '- [ ] Chase it 📅 2026-09-25 👤 @dana ^chase',
      'the block id still ends the line',
    );
  });

  test('changes a priority or date in the format the task uses', () => {
    assert.strictEqual(
      setTaskPriority('- [ ] Plan 🔽 📅 2026-09-20', 3, 'high'),
      '- [ ] Plan 📅 2026-09-20 ⏫',
    );
    assert.strictEqual(
      setTaskPriority('- [ ] Plan [priority:: low]', 3, undefined),
      '- [ ] Plan',
    );
    assert.strictEqual(
      setTaskPriority('- [ ] Plan [due:: 2026-09-20]', 3, 'highest'),
      '- [ ] Plan [due:: 2026-09-20] [priority:: highest]',
    );
    assert.strictEqual(
      setTaskDate('- [ ] Plan 📅 2026-09-20 ⏫', 3, 'due', '2026-09-14'),
      '- [ ] Plan 📅 2026-09-14 ⏫',
    );
    assert.strictEqual(
      setTaskDate('- [ ] Plan', 3, 'due', '2026-09-14', 'dataview'),
      '- [ ] Plan [due:: 2026-09-14]',
    );
    assert.strictEqual(
      setTaskDate('- [ ] Plan (due:: 2026-09-20)', 3, 'due', undefined),
      '- [ ] Plan',
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

  suite('projected repeats', () => {
    const now = at(2026, 9, 27);
    const days = (dates: number[]): string[] => dates.map(formatIsoDate);
    const project = (recurrence: string, due: number, from = at(2026, 9, 1), to = at(2026, 10, 31)): string[] =>
      days(projectRepeats({ recurrence, dueAt: due }, from, to, now));

    test('draws every date a rule lands on, after today, to the end of the range', () => {
      assert.deepStrictEqual(project('every week', at(2026, 9, 29), at(2026, 9, 1), at(2026, 10, 27)), [
        '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27',
      ]);
      assert.deepStrictEqual(project('every month on the last', at(2026, 10, 31), at(2026, 10, 1), at(2027, 3, 31)), [
        '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
      ]);
      assert.deepStrictEqual(project('every month on the last Friday', at(2026, 9, 25), at(2026, 9, 1), at(2026, 12, 31)), [
        '2026-10-30', '2026-11-27', '2026-12-25',
      ]);
      assert.deepStrictEqual(project('every other week on Monday, Thursday', at(2026, 9, 28), at(2026, 9, 1), at(2026, 10, 18)), [
        '2026-10-01', '2026-10-12', '2026-10-15',
      ]);
      assert.deepStrictEqual(project('every year', at(2026, 12, 31), at(2026, 1, 1), at(2028, 12, 31)), ['2027-12-31', '2028-12-31']);
    });

    test('an overdue task is drawn again from today on, on its own sequence', () => {
      // Due Tuesday the 1st, still open on Sunday the 27th.
      assert.deepStrictEqual(project('every Tuesday', at(2026, 9, 1), at(2026, 9, 1), at(2026, 10, 13)), [
        '2026-09-29', '2026-10-06', '2026-10-13',
      ]);
    });

    test('a range after today starts where it starts', () => {
      assert.deepStrictEqual(project('every week', at(2026, 9, 29), at(2026, 10, 12), at(2026, 10, 25)), ['2026-10-13', '2026-10-20']);
    });

    test('projects nothing for a when done rule, a rule it cannot read, or a task with no date', () => {
      assert.deepStrictEqual(project('every week when done', at(2026, 9, 29)), []);
      assert.deepStrictEqual(project('whenever I feel like it', at(2026, 9, 29)), []);
      assert.deepStrictEqual(days(projectRepeats({ recurrence: 'every week' }, at(2026, 9, 1), at(2026, 10, 31), now)), []);
    });

    test('a task with only a scheduled date repeats on that', () => {
      assert.deepStrictEqual(
        days(projectRepeats({ recurrence: 'every week', scheduledAt: at(2026, 9, 29) }, at(2026, 9, 1), at(2026, 10, 13), now)),
        ['2026-10-06', '2026-10-13'],
      );
    });

    test('stops at a year of dates', () => {
      assert.strictEqual(project('every day', at(2026, 9, 28), at(2026, 9, 1), at(2030, 1, 1)).length, PROJECTED_REPEATS);
    });

    test('agrees with the next occurrence completing the task writes', () => {
      for (const rule of ['every day', 'every week', 'every 2 weeks', 'every month on the 31st', 'every month on the second Tuesday', 'every weekday', 'every quarter', 'every weekend']) {
        const line = `- [x] Water the plants 📅 2026-10-30 🔁 ${rule} ✅ 2026-10-30`;
        const next = createNextOccurrence(line, 3, at(2026, 10, 30)) ?? '';
        const written = /📅 (\d{4}-\d{2}-\d{2})/.exec(next)?.[1];
        const [first] = project(rule, at(2026, 10, 30), at(2026, 10, 1), at(2027, 12, 31));
        assert.strictEqual(first, written, rule);
      }
    });
  });
});
