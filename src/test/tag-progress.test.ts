import * as assert from 'assert';
import { formatProgressCount, speakProgressCount, speakProgressText } from '../domain/tasks/progressCount';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  collectTagProgress,
  computeTagProgress,
  describeTagProgress,
  progressRatio,
  summarizeTasks,
} from '../domain/tasks/tagProgress';
import { DEFAULT_TASK_POLICY } from '../domain/tasks/taskPolicy';
import { normalizePreferences } from '../core/storage/preferencesSchema';
import { createQueryContext } from '../domain/query/queryContext';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { findHubProgress } from '../ui/state/editorLensState';
import { WorkspaceIndex } from '../domain/model';

const now = new Date(2026, 9, 3, 9, 0, 0).getTime();

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

suite('Tag progress', () => {
  const index = indexOf({
    'atlas.md': [
      '# Atlas #project/atlas',
      '- [x] Pick a vendor',
      '- [ ] Send the proposal 📅 2026-10-09',
      '- [ ] Book the room 📅 2026-10-06',
      '- [ ] Call the lawyer 📅 2026-09-30',
      '- [ ] Write the brief',
      '- [ ] Renew the lease 📅 2026-08-01',
      '  - [ ] Draft the outline',
      '  - [x] Gather notes',
    ].join('\n'),
    'meeting.md': ['---', 'project: atlas', '---', '# Check-in', '- [x] Share the minutes'].join('\n'),
    'borealis.md': ['# Borealis #project/borealis', '- [x] Ship it'].join('\n'),
    'misc.md': '# Misc\n- [ ] Untagged',
  });

  test('counts a tag’s tasks by its headings and front matter, steps aside', () => {
    const atlas = computeTagProgress(index, '#project/atlas', now);
    assert.ok(atlas);
    assert.strictEqual(atlas.total, 7, 'six in the note, one by front matter; two steps left out');
    assert.strictEqual(atlas.needsDate, 1, 'a task two months past due needs a new date, and is not counted overdue');
    assert.strictEqual(atlas.done, 2);
    assert.strictEqual(atlas.overdue, 1);
    assert.strictEqual(atlas.nextDue?.title, 'Book the room');
    assert.strictEqual(atlas.nextDue?.filePath, 'atlas.md');
  });

  test('collects every tag in one pass, or only those asked for', () => {
    const all = collectTagProgress(index, now);
    assert.deepStrictEqual([...all.keys()].sort(), ['#project/atlas', '#project/borealis']);
    const one = collectTagProgress(index, now, new Set(['#project/borealis']));
    assert.deepStrictEqual([...one.keys()], ['#project/borealis']);
    assert.strictEqual(computeTagProgress(index, '#project/none', now), undefined);
  });

  test('says how far along a tag is, in words', () => {
    const policy = DEFAULT_TASK_POLICY;
    const atlas = computeTagProgress(index, '#project/atlas', now);
    assert.ok(atlas);
    assert.strictEqual(describeTagProgress(atlas, now, policy), '2/7 done (29%) · 1 overdue · 1 needs a new date · next due in 3 days');
    const borealis = computeTagProgress(index, '#project/borealis', now);
    assert.ok(borealis);
    assert.strictEqual(describeTagProgress(borealis, now, policy), '1/1 done (100%) · all done');
    assert.strictEqual(
      describeTagProgress({ total: 2, done: 0, overdue: 0, needsDate: 0, nextDue: { taskId: 't', title: 'x', dueAt: new Date(2026, 11, 25).getTime(), filePath: 'a.md', lineNumber: 1 } }, now, policy),
      '0/2 done (0%) · next due 2026-12-25',
    );
    assert.strictEqual(describeTagProgress({ total: 3, done: 1, overdue: 0, needsDate: 0 }, now, policy), '1/3 done (33%)');
    assert.strictEqual(describeTagProgress({ total: 4, done: 0, overdue: 2, needsDate: 2 }, now, policy), '0/4 done (0%) · 2 overdue · 2 need a new date');
  });

  test('sums up one note’s own tasks, steps aside, and nothing for none', () => {
    const tasks = [...index.files.get('atlas.md')!.tasks];
    const summary = summarizeTasks(tasks, now);
    assert.deepStrictEqual(
      summary && { total: summary.total, done: summary.done, overdue: summary.overdue, needsDate: summary.needsDate },
      { total: 6, done: 1, overdue: 1, needsDate: 1 },
    );
    assert.strictEqual(summarizeTasks([], now), undefined);
  });

  test('a ratio is the share done, and 0 for no tasks', () => {
    assert.strictEqual(progressRatio({ done: 1, total: 4 }), 0.25);
    assert.strictEqual(progressRatio({ done: 0, total: 0 }), 0);
  });

  test('a tag’s page carries its progress, each part a search for the tasks it counts', () => {
    const snapshot = createSearchPageSnapshot(index, normalizePreferences({}), '#project/atlas', { queryContext: createQueryContext(now) });
    const progress = snapshot.tagPage?.progress;
    assert.deepStrictEqual(
      progress && { done: progress.done, total: progress.total, overdue: progress.overdue, label: progress.label },
      { done: 2, total: 7, overdue: 1, label: '2/7 done (29%) · 1 overdue · 1 needs a new date · next due in 3 days' },
    );
    const found = (query: string | undefined): number => evaluateQuery(index, parseQuery(query ?? '').node, createQueryContext(now)).tasks.length;
    assert.deepStrictEqual(
      progress?.parts.map((part) => [part.text, found(part.query)]),
      [['2/7 done (29%)', 2], ['1 overdue', 1], ['1 needs a new date', 1], ['next due in 3 days', 1]],
      'each part’s search finds as many tasks as it counts',
    );
    assert.ok(progress?.parts.every((part) => part.query && part.tip));
    const plain = createSearchPageSnapshot(index, normalizePreferences({}), 'is:open', { queryContext: createQueryContext(now) });
    assert.strictEqual(plain.tagPage, undefined, 'only a tag’s page has one');
  });

  test('a search that narrows the tag stays its page: the hub, the whole tag’s progress, the part searched on', () => {
    const hubbed = indexOf({
      'hub.md': ['---', 'describes: project/atlas', '---', '# Atlas hub'].join('\n'),
      'atlas.md': ['# Atlas #project/atlas', '- [x] Pick a vendor', '- [ ] Call the lawyer 📅 2026-09-30', '- [ ] Write the brief'].join('\n'),
      'linking.md': '# Linking\nSee [[hub]].\n- [ ] Linked task 📅 2026-09-29',
      'other.md': '# Other #project/borealis @dana\n- [ ] Elsewhere',
    });
    const search = (text: string) => createSearchPageSnapshot(hubbed, normalizePreferences({}), text, { queryContext: createQueryContext(now) });
    const plainPage = search('#project/atlas').tagPage;
    assert.ok(plainPage?.progress);
    assert.strictEqual(plainPage.filtered, undefined);
    assert.strictEqual(plainPage.hubLinkCount, 1, 'the plain page lists what links to the hub');
    const overdueQuery = plainPage.progress.parts[1].query ?? '';

    const filtered = search(overdueQuery);
    const page = filtered.tagPage;
    assert.ok(page?.progress);
    assert.strictEqual(filtered.tag?.key, '#project/atlas', 'still the tag’s page');
    assert.strictEqual(filtered.hub?.filePath, 'hub.md', 'with its hub');
    assert.strictEqual(page.filtered, true);
    assert.strictEqual(page.hubLinkCount, 0, 'what links to the hub is not filtered, so it is left out');
    assert.strictEqual(page.progress.label, plainPage.progress.label, 'the bar counts the whole tag');
    assert.deepStrictEqual(page.progress.parts.map((part) => [part.text, part.active === true]), [
      ['1/3 done (33%)', false],
      ['1 overdue', true],
    ]);
    assert.deepStrictEqual(filtered.tasks.map((task) => task.task.title), ['Call the lawyer']);

    assert.strictEqual(search('#project/atlas @dana is:open').tag, undefined, 'two tags is a search, not a page');
    assert.strictEqual(search('is:open').tag, undefined);
  });

  test('a hub note’s lens says how far along each tag it describes is', () => {
    const hub = parseMarkdown('hub.md', ['---', 'describes: [project/atlas, project/none]', '---', '# Atlas'].join('\n'));
    assert.deepStrictEqual(findHubProgress(hub, index, createQueryContext(now)), [
      { tagKey: '#project/atlas', tagLabel: '#project/atlas', text: '2/7 done (29%) · 1 overdue · 1 needs a new date · next due in 3 days' },
    ]);
    assert.deepStrictEqual(findHubProgress(parseMarkdown('plain.md', '# Plain'), index, createQueryContext(now)), []);
  });
});

suite('Progress count', () => {
  test('shows done of total and the share, never 100% short of all of them', () => {
    assert.strictEqual(formatProgressCount(3, 8), '3/8 done (38%)');
    assert.strictEqual(formatProgressCount(0, 4), '0/4 done (0%)');
    assert.strictEqual(formatProgressCount(5, 5), '5/5 done (100%)');
    assert.strictEqual(formatProgressCount(199, 200), '199/200 done (99%)', 'not a finished-looking 100%');
    assert.strictEqual(formatProgressCount(2, 5, { compact: true }), '2/5 (40%)');
  });

  test('says every figure in a text as it is spoken, and leaves other text alone', () => {
    assert.strictEqual(speakProgressCount(3, 8), '3 of 8 done, 38%');
    assert.strictEqual(speakProgressText('Steps 1/3 done (33%) · next: Pack'), 'Steps 1 of 3 done, 33% · next: Pack');
    assert.strictEqual(speakProgressText('2/5 (40%) · ↩3'), '2 of 5 done, 40% · ↩3');
    assert.strictEqual(speakProgressText('Due 2026/10/09'), 'Due 2026/10/09');
  });
});
