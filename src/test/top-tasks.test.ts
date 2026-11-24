import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { Task, WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import {
  findEarlierTop,
  findTopSection,
  formatTopLink,
  isTopHeading,
  makeMarker,
  planTopTasks,
  readDayTop,
  readTopCount,
  type TopPlan,
  topLimitSentence,
  topOfferLabel,
  topTasksName,
  topTasksOf,
  usesTopTasks,
} from '../domain/tasks/topTasks';
import { createAgenda } from '../ui/state/agendaState';
import { formatReview, summarizeReview } from '../ui/state/reviewState';
import { buildTopRows, describeTopLenses, describeTopStatus } from '../ui/state/topTasksState';

/**
 * A day's top tasks (docs/implementation/50-top-three.md): the name the
 * number gives, which heading is the section, how it is read back, how a
 * line gets a marker, the edit a new set of picks makes, and what each
 * surface says of the picks.
 */
suite('Top three', () => {
  /** Noon on a day of November 2026. */
  const at = (day: number): number => new Date(2026, 10, day, 12).getTime();
  const now = at(24);
  const context = createQueryContext(now);

  const indexOf = (notes: Record<string, string[]>): WorkspaceIndex =>
    buildWorkspaceIndex(
      new Map(Object.entries(notes).map(([filePath, lines]) => [filePath, parseMarkdown(filePath, lines.join('\n'))])),
    );

  const BOREALIS = [
    '# Borealis',
    '',
    '## Vendor sync',
    '- [ ] Send the vendor quote 📅 2026-11-23 ^vendor-quote',
    '- [ ] Call Ren about the depot list',
    '- [x] Book the cold room ✅ 2026-11-24 ^cold-room',
    '- [x] Order the labels ✅ 2026-11-23 ^labels',
  ];
  const LEDGER = ['# Ledger migration', '', '- [ ] Draft the cutover runbook ^cutover-runbook', '- [ ] Draft the cutover checklist'];

  const notes = {
    'projects/Borealis.md': BOREALIS,
    'projects/Ledger migration.md': LEDGER,
    'journal/2026-11-23.md': [
      '# 2026-11-23',
      '',
      '## Top three',
      '',
      '- [[Borealis#^vendor-quote|Send the vendor quote]]',
      '- [[Borealis#^labels|Order the labels]]',
      '- [[Borealis#^cold-room|Book the cold room]]',
    ],
    'journal/2026-11-24.md': [
      '# 2026-11-24',
      '',
      '## Top three',
      '',
      '- [[Ledger migration#^cutover-runbook|Draft the cutover runbook]]',
      '- [[Borealis#^cold-room|Book the cold room]]',
      '- [ ] Outline the Q1 staffing ask',
      '- [[Borealis#^gone|A line since deleted]]',
      '',
      '## Carried over',
      '',
      '### Top three',
      '([[2026-11-23#Top three]])',
      '- [ ] Reply to Dana',
    ],
  };
  const index = indexOf(notes);
  const taskTitled = (from: WorkspaceIndex, title: string, filePath?: string): Task => {
    const task = [...from.tasks.values()].find((each) => each.title.startsWith(title) && (!filePath || each.filePath === filePath));
    assert.ok(task, `a task titled ${title}`);
    return task;
  };

  test('names the picks by the number, as a word', () => {
    assert.deepStrictEqual([1, 3, 5, 9].map(topTasksName), ['Top task', 'Top three', 'Top five', 'Top nine']);
    assert.deepStrictEqual([1, 3].map(topOfferLabel), ["Pick today's top task", "Pick today's three"]);
    assert.strictEqual(topLimitSentence(3), 'Three is the limit.');
  });

  test('reads the number from the setting, 0 to 9, three for anything else', () => {
    const settings = (value: unknown) => ({ get: <T>(_key: string, fallback: T): T => (value === undefined ? fallback : (value as T)) });
    assert.deepStrictEqual(
      [undefined, 5, 0, 12, -1, 'four', 2.6].map((value) => readTopCount(settings(value))),
      [3, 5, 0, 9, 0, 3, 3],
    );
  });

  test('takes a heading of Top and a number, or Top task, as the section', () => {
    assert.deepStrictEqual(
      ['Top three', 'top 5', 'TOP TASK', 'Top three #focus', 'Top of mind', 'Topics', 'Three'].map(isTopHeading),
      [true, true, true, true, false, false, false],
    );
  });

  test('finds the section below the title, and not the one a rollover wrote under Carried over', () => {
    const section = findTopSection(notes['journal/2026-11-24.md']);
    assert.deepStrictEqual([section?.headingLine, section?.level, section?.bodyEnd], [2, 2, 9]);
    assert.deepStrictEqual(section?.items.map((item) => [item.line, item.checkbox]), [[4, false], [5, false], [6, true], [7, false]]);
    assert.strictEqual(findTopSection(['# Top three', '', '- [ ] Call Ren']), undefined, 'a title is not the section');
    assert.strictEqual(findTopSection(['# 2026-11-24', '## Carried over', '### Top three', '- [ ] Call Ren']), undefined);
  });

  test('reads a day back: links to lines, a task written there, a broken link, and more than the limit', () => {
    const top = readDayTop(index, '2026-11-24');
    assert.deepStrictEqual(
      top?.picks.map((pick) => [pick.words, pick.task?.filePath, pick.ownLine]),
      [
        ['Draft the cutover runbook', 'projects/Ledger migration.md', undefined],
        ['Book the cold room', 'projects/Borealis.md', undefined],
        ['Outline the Q1 staffing ask', 'journal/2026-11-24.md', true],
        ['A line since deleted', undefined, undefined],
      ],
    );
    assert.strictEqual(topTasksOf(top).length, 3);
    assert.strictEqual(readDayTop(index, '2026-11-22'), undefined, 'no note for the day');
    assert.strictEqual(findEarlierTop(index, '2026-11-24')?.date, '2026-11-23');
    assert.strictEqual(usesTopTasks(index, now), true);
    assert.strictEqual(usesTopTasks(index, at(24) + 20 * 24 * 60 * 60 * 1000), false, 'not once two weeks have passed');
  });

  test('makes a marker from a title\'s first three words, unique in its note', () => {
    assert.strictEqual(makeMarker('Send the vendor quote #project/borealis', new Set()), 'send-the-vendor');
    assert.strictEqual(makeMarker('Draft the cutover checklist', new Set(['draft-the-cutover', 'draft-the-cutover-2'])), 'draft-the-cutover-3');
    assert.strictEqual(makeMarker('Résumé: v2!', new Set()), 'rsum-v2');
    assert.strictEqual(makeMarker('…', new Set()), 'task');
  });

  test('writes a link in the link style of today\'s note', () => {
    const link = { title: 'Send the [vendor] quote #project/borealis', marker: 'vendor-quote', todayPath: 'journal/2026-11-24.md', targetPath: 'projects/Ledger migration.md' };
    assert.strictEqual(formatTopLink({ ...link, style: 'wiki' }), '[[Ledger migration#^vendor-quote|Send the vendor quote]]');
    assert.strictEqual(formatTopLink({ ...link, style: 'markdown' }), '[Send the vendor quote](../projects/Ledger%20migration.md#^vendor-quote)');
  });

  /** A note's text with a plan's edit to it applied. */
  const applyPlan = (lines: readonly string[], plan: TopPlan): string[] => {
    if (!plan.today) {
      return [...lines];
    }
    const { start, end, text } = plan.today;
    const before = lines.slice(0, start.line).concat(lines[start.line].slice(0, start.character)).join('\n');
    const after = [lines[end.line].slice(end.character), ...lines.slice(end.line + 1)].join('\n');
    return `${before}${text}${after}`.split('\n');
  };

  test('plans a new section under the title, above every other section, with a marker for a line that has none', () => {
    const today = ['# 2026-11-25', '', 'A slow start.', '', '## Carried over', '', '- [ ] Reply to Dana', ''];
    const fresh = indexOf({ ...notes, 'journal/2026-11-25.md': today });
    const plan = planTopTasks({
      index: fresh,
      content: today.join('\n'),
      todayPath: 'journal/2026-11-25.md',
      style: 'wiki',
      count: 3,
      choices: [
        { task: taskTitled(fresh, 'Draft the cutover checklist') },
        { task: taskTitled(fresh, 'Send the vendor quote') },
        { title: 'Outline the Q1  staffing ask' },
        { task: taskTitled(fresh, 'Reply to Dana', 'journal/2026-11-25.md') },
      ],
    });
    assert.deepStrictEqual(applyPlan(today, plan), [
      '# 2026-11-25',
      '',
      'A slow start.',
      '',
      '## Top three',
      '',
      '- [[Ledger migration#^draft-the-cutover|Draft the cutover checklist]]',
      '- [[Borealis#^vendor-quote|Send the vendor quote]]',
      '- [ ] Outline the Q1 staffing ask',
      '- [[2026-11-25#^reply-to-dana|Reply to Dana]]',
      '',
      '## Carried over',
      '',
      '- [ ] Reply to Dana ^reply-to-dana',
      '',
    ]);
    assert.deepStrictEqual(
      plan.markers.map(({ task, marker, line }) => [task.filePath, marker, line]),
      [['projects/Ledger migration.md', 'draft-the-cutover', '- [ ] Draft the cutover checklist ^draft-the-cutover']],
      'the line in today\'s note gets its marker in today\'s edit',
    );
  });

  test('uses a heading already there, and names a new one by the setting', () => {
    const templated = ['# 2026-11-25', '', '### Top 5', '', '## Notes', ''];
    const plan = planTopTasks({ index, content: templated.join('\n'), todayPath: 'journal/2026-11-25.md', style: 'wiki', count: 3, choices: [{ title: 'Call Ren' }] });
    assert.deepStrictEqual(applyPlan(templated, plan), ['# 2026-11-25', '', '### Top 5', '', '- [ ] Call Ren', '', '## Notes', '']);
    const bare = ['A note with no heading.'];
    const five = planTopTasks({ index, content: bare.join('\n'), todayPath: 'journal/2026-11-25.md', style: 'wiki', count: 5, choices: [{ title: 'Call Ren' }] });
    assert.deepStrictEqual(applyPlan(bare, five), ['A note with no heading.', '', '## Top five', '', '- [ ] Call Ren', '']);
  });

  test('picking again rewrites the items alone, in the order checked, and keeps a task written there', () => {
    const today = [...notes['journal/2026-11-24.md']];
    today.splice(8, 0, 'Do the runbook before lunch.');
    const again = indexOf({ ...notes, 'journal/2026-11-24.md': today });
    const plan = planTopTasks({
      index: again,
      content: today.join('\n'),
      todayPath: 'journal/2026-11-24.md',
      style: 'wiki',
      count: 3,
      choices: [{ task: taskTitled(again, 'Outline the Q1 staffing ask') }, { task: taskTitled(again, 'Draft the cutover runbook') }],
    });
    assert.deepStrictEqual(applyPlan(today, plan).slice(2, 10), [
      '## Top three',
      '',
      '- [ ] Outline the Q1 staffing ask',
      '- [[Ledger migration#^cutover-runbook|Draft the cutover runbook]]',
      '',
      'Do the runbook before lunch.',
      '',
      '## Carried over',
    ]);
    assert.deepStrictEqual(plan.markers, []);
    const same = planTopTasks({ index: again, content: applyPlan(today, plan).join('\n'), todayPath: 'journal/2026-11-24.md', style: 'wiki', count: 3, choices: [{ task: taskTitled(again, 'Draft the cutover runbook') }] });
    assert.ok(same.today, 'a different set is a change');
  });

  test('clearing leaves the heading, and a note with no heading as it is', () => {
    const today = ['# 2026-11-24', '', '## Top three', '', '- [[Borealis#^cold-room|Book the cold room]]', '', '## Carried over', ''];
    const cleared = planTopTasks({ index, content: today.join('\n'), todayPath: 'journal/2026-11-24.md', style: 'wiki', count: 3, choices: [] });
    assert.deepStrictEqual(applyPlan(today, cleared), ['# 2026-11-24', '', '## Top three', '', '## Carried over', '']);
    assert.deepStrictEqual(planTopTasks({ index, content: '# 2026-11-24\n', todayPath: 'journal/2026-11-24.md', style: 'wiki', count: 3, choices: [] }), { markers: [] });
    const unchanged = planTopTasks({ index, content: today.join('\n'), todayPath: 'journal/2026-11-24.md', style: 'wiki', count: 3, choices: [{ task: taskTitled(index, 'Book the cold room') }] });
    assert.strictEqual(unchanged.today, undefined, 'the same picks write nothing');
  });

  test('leads the Tasks view with the picks, in every grouping, each listed there only', () => {
    for (const groupBy of ['due', 'priority', 'status', 'assignee'] as const) {
      const groups = createAgenda(index, context, { upcomingDays: 7, groupBy, doneToday: true, topCount: 3 });
      assert.strictEqual(groups[0].id, 'top', groupBy);
      assert.strictEqual(groups[0].label, 'Top three');
      assert.deepStrictEqual(
        groups[0].entries.map((entry) => [entry.title, entry.task.completed]),
        [['Draft the cutover runbook', false], ['Book the cold room', true], ['Outline the Q1 staffing ask', false]],
      );
      const elsewhere = groups.slice(1).flatMap((group) => group.entries.map((entry) => entry.title));
      assert.ok(!elsewhere.includes('Draft the cutover runbook') && !elsewhere.includes('Book the cold room'), groupBy);
    }
    assert.ok(createAgenda(index, context, { upcomingDays: 7, topCount: 0 }).every((group) => group.id !== 'top'), 'off at 0');
    assert.ok(createAgenda(index, context, { upcomingDays: 7 }).every((group) => group.id !== 'top'), 'and when not asked for');
  });

  test('says in the status bar how many are done and the first that is not', () => {
    assert.deepStrictEqual(
      [describeTopStatus(index, now, 3)?.kind, describeTopStatus(index, now, 3)?.text, describeTopStatus(index, now, 3)?.next?.title],
      ['next', '1/3 · Draft the cutover runbook', 'Draft the cutover runbook'],
    );
    assert.strictEqual(describeTopStatus(index, now, 0), undefined, 'nothing while the feature is off');
    const allDone = indexOf({ 'projects/Borealis.md': BOREALIS, 'journal/2026-11-24.md': ['# 2026-11-24', '## Top three', '- [[Borealis#^cold-room|Book the cold room]]'] });
    assert.deepStrictEqual([describeTopStatus(allDone, now, 3)?.kind, describeTopStatus(allDone, now, 3)?.text], ['done', '1/1 done']);
    // The next day has no picks: the offer shows, since the practice is in use.
    assert.deepStrictEqual([describeTopStatus(index, at(25), 3)?.kind, describeTopStatus(index, at(25), 3)?.text], ['offer', "Pick today's three"]);
    const unused = indexOf({ 'projects/Borealis.md': BOREALIS, 'journal/2026-11-24.md': ['# 2026-11-24'] });
    assert.strictEqual(describeTopStatus(unused, now, 3), undefined, 'and not where no daily note has a section');
  });

  test('finds today\'s picks with is:top', () => {
    const titles = (query: string, moment = now): string[] =>
      evaluateQuery(index, parseQuery(query).node, createQueryContext(moment)).tasks.map((task) => task.title).sort();
    assert.deepStrictEqual(titles('is:top'), ['Book the cold room', 'Draft the cutover runbook', 'Outline the Q1 staffing ask']);
    assert.deepStrictEqual(titles('is:top is:open'), ['Draft the cutover runbook', 'Outline the Q1 staffing ask']);
    assert.deepStrictEqual(titles('is:top', at(23)), ['Book the cold room', 'Order the labels', 'Send the vendor quote']);
    assert.deepStrictEqual(titles('is:top', at(22)), []);
    assert.ok(!titles('-is:top is:task').includes('Draft the cutover runbook'));
  });

  test('lists the picker\'s rows: chosen, left from yesterday, overdue, then the rest', () => {
    const { rows, leftLabel } = buildTopRows(index, context, { query: '', count: 3 });
    assert.strictEqual(leftLabel, "Left from yesterday's three");
    assert.deepStrictEqual(
      rows.map((row) => [row.group, row.task.title, row.stays]).slice(0, 5),
      [
        ['chosen', 'Draft the cutover runbook', undefined],
        ['chosen', 'Book the cold room', 'done'],
        ['chosen', 'Outline the Q1 staffing ask', 'written'],
        ['left', 'Send the vendor quote', undefined],
        ['urgent', rows[4].task.title, undefined],
      ],
    );
    assert.strictEqual(rows.find((row) => row.task.title === 'Send the vendor quote')?.detail, 'Overdue 1 day · Borealis › Vendor sync');
    assert.strictEqual(new Set(rows.map((row) => row.task.id)).size, rows.length, 'each task once');
    assert.ok(rows.every((row) => row.group === 'chosen' || !row.task.completed), 'only a pick is listed once done');
  });

  test('puts a lens above the section, and the offer above the first heading of a day with none', () => {
    const file = (from: WorkspaceIndex, path: string) => {
      const parsed = from.files.get(path);
      assert.ok(parsed);
      return parsed;
    };
    assert.deepStrictEqual(
      describeTopLenses({ index, file: file(index, 'journal/2026-11-24.md'), now, count: 3 }).map((lens) => [lens.line, lens.title]),
      [[2, 'Top three · 1 of 3 done · Change…']],
    );
    const next = indexOf({ ...notes, 'journal/2026-11-25.md': ['', '# 2026-11-25', '', '- [ ] Reply to Dana'] });
    assert.deepStrictEqual(
      describeTopLenses({ index: next, file: file(next, 'journal/2026-11-25.md'), now: at(25), count: 3 }).map((lens) => [lens.line, lens.title]),
      [[1, "Pick today's three… · 2 left from yesterday"]],
    );
    assert.deepStrictEqual(describeTopLenses({ index, file: file(index, 'journal/2026-11-23.md'), now, count: 3 }), [], 'only on today\'s note');
    assert.deepStrictEqual(describeTopLenses({ index, file: file(index, 'journal/2026-11-24.md'), now, count: 0 }), [], 'and not while off');
  });

  test('writes the review\'s section and figure for a week with picks', () => {
    const week = indexOf({ ...notes, 'journal/2026-11-27.md': ['# 2026-11-27', '', '- [ ] Reply to Dana'] });
    const range = { name: 'week-2026-11-22-2026-11-28', title: '2026-11-22 to 2026-11-28', start: new Date(2026, 10, 22).getTime(), end: new Date(2026, 10, 29).getTime() };
    const summary = summarizeReview(week, range, { queryContext: context, topCount: 3 });
    assert.deepStrictEqual([summary.top?.name, summary.top?.done, summary.top?.picked], ['Top three', 2, 7]);
    const review = formatReview(summary).split('\n');
    const start = review.indexOf('### Top three');
    assert.ok(start > review.indexOf('### Completed') && start < review.indexOf('### Still open'), 'after Completed');
    assert.deepStrictEqual(review.slice(start, start + 5), [
      '### Top three',
      '',
      '- Mon 2026-11-23 · 1 of 3 · left: [[Borealis#^vendor-quote|Send the vendor quote]], [[Borealis#^cold-room|Book the cold room]]',
      '- Tue 2026-11-24 · 1 of 4 · left: [[Ledger migration#^cutover-runbook|Draft the cutover runbook]], [ ] Outline the Q1 staffing ask, [[Borealis#^gone|A line since deleted]]',
      '- Fri 2026-11-27 · none picked',
    ]);
    assert.ok(review.some((line) => line.includes('**Top three:** 2 of 7')), 'the tally gains the figure');
    assert.strictEqual(summarizeReview(week, range, { queryContext: context, topCount: 0 }).top, undefined, 'none while off');
    const quiet = { ...range, start: new Date(2026, 10, 1).getTime(), end: new Date(2026, 10, 8).getTime() };
    assert.strictEqual(summarizeReview(week, quiet, { queryContext: context, topCount: 3 }).top, undefined, 'none for a period with no picks');
  });
});
