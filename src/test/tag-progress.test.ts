import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  collectTagProgress,
  computeTagProgress,
  describeTagProgress,
  progressRatio,
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
    assert.strictEqual(atlas.total, 6, 'five in the note, one by front matter; two steps left out');
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
    assert.strictEqual(describeTagProgress(atlas, now, policy), '2 of 6 done · 1 overdue · next due in 3 days');
    const borealis = computeTagProgress(index, '#project/borealis', now);
    assert.ok(borealis);
    assert.strictEqual(describeTagProgress(borealis, now, policy), '1 of 1 done · all done');
    assert.strictEqual(
      describeTagProgress({ total: 2, done: 0, overdue: 0, nextDue: { taskId: 't', title: 'x', dueAt: new Date(2026, 11, 25).getTime(), filePath: 'a.md', lineNumber: 1 } }, now, policy),
      '0 of 2 done · next due 2026-12-25',
    );
    assert.strictEqual(describeTagProgress({ total: 3, done: 1, overdue: 0 }, now, policy), '1 of 3 done');
  });

  test('a ratio is the share done, and 0 for no tasks', () => {
    assert.strictEqual(progressRatio({ done: 1, total: 4 }), 0.25);
    assert.strictEqual(progressRatio({ done: 0, total: 0 }), 0);
  });

  test('a tag’s page carries its progress, and a way to its overdue tasks', () => {
    const snapshot = createSearchPageSnapshot(index, normalizePreferences({}), '#project/atlas', { queryContext: createQueryContext(now) });
    assert.deepStrictEqual(snapshot.tagPage?.progress, {
      done: 2,
      total: 6,
      overdue: 1,
      label: '2 of 6 done · 1 overdue · next due in 3 days',
      overdueQuery: '#project/atlas is:overdue -is:step',
    });
    const overdue = evaluateQuery(index, parseQuery(snapshot.tagPage?.progress?.overdueQuery ?? '').node, createQueryContext(now));
    assert.deepStrictEqual(overdue.tasks.map((task) => task.lineNumber), [5], 'the search finds the overdue task');
    const plain = createSearchPageSnapshot(index, normalizePreferences({}), 'is:open', { queryContext: createQueryContext(now) });
    assert.strictEqual(plain.tagPage, undefined, 'only a tag’s page has one');
  });

  test('a hub note’s lens says how far along each tag it describes is', () => {
    const hub = parseMarkdown('hub.md', ['---', 'describes: [project/atlas, project/none]', '---', '# Atlas'].join('\n'));
    assert.deepStrictEqual(findHubProgress(hub, index, createQueryContext(now)), [
      { tagKey: '#project/atlas', tagLabel: '#project/atlas', text: '2 of 6 done · 1 overdue · next due in 3 days' },
    ]);
    assert.deepStrictEqual(findHubProgress(parseMarkdown('plain.md', '# Plain'), index, createQueryContext(now)), []);
  });
});
