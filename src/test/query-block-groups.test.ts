import * as assert from 'assert';

import { renderQueryBlockHtml } from '../ui/preview/queryBlockHtml';
import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryBlockSnapshot, formatQueryBlock, parseQueryBlockInfo } from '../ui/state/queryBlockState';
import { queryBlockGroupOfBoard, readQueryBlockGroup } from '../ui/state/queryBlockGroups';
import { writeQueryBlock } from '../ui/state/plainMarkdown';
import { createQueryContext } from '../domain/query/queryContext';
import { ParsedFile, WorkspaceIndex } from '../domain/model';

/** Noon on Wednesday 2026-10-28. */
const now = new Date(2026, 9, 28, 12).getTime();
const context = createQueryContext(now);

function workspace(): WorkspaceIndex {
  const notes: Record<string, string> = {
    'notes/Atlas.md': [
      '# Atlas #project/atlas',
      '- [ ] Chase the contractor 📅 2026-10-20 ⏫ #context/phone 👤 @dana',
      '- [ ] Book the room 📅 2026-10-28 #context/computer',
      '- [/] Draft the brief 📅 2026-10-29 ⏳ 2026-10-27 🔺',
      '- [ ] Water the plants 🛫 2026-11-04 #context/phone #context/home',
      '- [x] Filed the report 📅 2026-10-21 ✅ 2026-10-22',
    ].join('\n'),
    'notes/Beacon.md': [
      '# Beacon',
      '- [ ] Call Ren 📅 2026-09-01 🔽 👤 @ren',
      '- [-] Print the flyers ❌ 2026-10-01',
      '- [!] Ask legal',
    ].join('\n'),
  };
  const files = new Map<string, ParsedFile>();
  Object.entries(notes).forEach(([filePath, content]) => files.set(filePath, parseMarkdown(filePath, content, { createdAt: now, updatedAt: now })));
  return buildWorkspaceIndex(files);
}

/** Each group as `label: titles`, in order. */
function groups(info: string, query = 'is:task'): string[] {
  const snapshot = createQueryBlockSnapshot(workspace(), query, parseQueryBlockInfo(info)!, { queryContext: context });
  return (snapshot.taskGroups ?? []).map((group) => `${group.label}: ${group.items.map((item) => item.title).join(', ')}`);
}

suite('Query blocks grouped by group=', () => {
  test('reads group= as sort= is read, and warns of a value it does not take', () => {
    assert.strictEqual(parseQueryBlockInfo('deckard group=due')?.group, 'due');
    assert.strictEqual(parseQueryBlockInfo('deckard group=For')?.group, 'assignee');
    assert.strictEqual(parseQueryBlockInfo('deckard group=#Context')?.group, '#context');
    const bad = parseQueryBlockInfo('deckard group=color sort=due');
    assert.strictEqual(bad?.group, undefined);
    assert.strictEqual(bad?.sort, 'due', 'the rest still reads');
    assert.match(bad?.warnings[0] ?? '', /^group must be due, scheduled, start, priority, status, note, tag, for, or a namespace such as #context, not "color"\.$/);
    assert.strictEqual(readQueryBlockGroup('#'), undefined);
    assert.match(parseQueryBlockInfo('deckard colour=red')?.warnings[0] ?? '', /group=/, 'the unknown option names it');
  });

  test('groups by due date as the board\'s due columns do, closed tasks last', () => {
    assert.deepStrictEqual(groups('deckard group=due'), [
      'Needs a new date: Call Ren',
      'Overdue: Chase the contractor',
      'Today: Book the room',
      'Tomorrow: Draft the brief',
      'No due date: Water the plants, Ask legal',
      'Done: Filed the report',
      'Cancelled: Print the flyers',
    ]);
  });

  test('groups by scheduled and start dates under their own words', () => {
    assert.deepStrictEqual(groups('deckard group=scheduled', 'is:open'), [
      'Earlier: Draft the brief',
      'No scheduled date: Call Ren, Chase the contractor, Book the room, Water the plants, Ask legal',
    ]);
    assert.deepStrictEqual(groups('deckard group=start', 'is:open'), [
      'Within a week: Water the plants',
      'No start date: Call Ren, Chase the contractor, Book the room, Draft the brief, Ask legal',
    ]);
  });

  test('groups by priority, highest first and none last, sorting within each group', () => {
    assert.deepStrictEqual(groups('deckard group=priority sort=title', 'is:open'), [
      'Highest: Draft the brief',
      'High: Chase the contractor',
      'Low: Call Ren',
      'No priority: Ask legal, Book the room, Water the plants',
    ]);
  });

  test('groups by status in the statuses\' order, an unknown character after, then Done and Cancelled', () => {
    assert.deepStrictEqual(groups('deckard group=status'), [
      'Todo: Call Ren, Chase the contractor, Book the room, Water the plants',
      'In progress: Draft the brief',
      'Unknown [!]: Ask legal',
      'Done: Filed the report',
      'Cancelled: Print the flyers',
    ]);
  });

  test('groups by note, by tag, by a namespace, and by who a task is for', () => {
    assert.deepStrictEqual(groups('deckard group=note', 'is:open'), [
      'Atlas: Chase the contractor, Book the room, Draft the brief, Water the plants',
      'Beacon: Call Ren, Ask legal',
    ]);
    assert.deepStrictEqual(groups('deckard group=#context', 'is:open'), [
      'Computer: Book the room',
      'Home: Water the plants',
      'Phone: Chase the contractor, Water the plants',
      'No context: Call Ren, Draft the brief, Ask legal',
    ], 'a task with two is in both');
    assert.deepStrictEqual(groups('deckard group=tag', 'is:open #project/atlas'), [
      '#context/computer: Book the room',
      '#context/home: Water the plants',
      '#context/phone: Chase the contractor, Water the plants',
      '#project/atlas: Chase the contractor, Book the room, Draft the brief, Water the plants',
    ], 'an inherited tag counts');
    assert.deepStrictEqual(groups('deckard group=for', 'is:open'), [
      '@dana: Chase the contractor',
      '@ren: Call Ren',
      'Nobody named: Book the room, Draft the brief, Water the plants, Ask legal',
    ]);
  });

  test('groups only the tasks the limit shows, and the totals still count them all', () => {
    const snapshot = createQueryBlockSnapshot(workspace(), 'is:open', parseQueryBlockInfo('deckard group=priority limit=2')!, { queryContext: context });
    assert.strictEqual(snapshot.taskCount, 6);
    const grouped = snapshot.taskGroups?.flatMap((group) => group.items.map((item) => item.title)).sort();
    assert.deepStrictEqual(grouped, snapshot.tasks.map((item) => item.title).sort());
    assert.strictEqual(grouped?.length, 2);
  });

  test('draws each group under its heading in a list and in a table', () => {
    const list = renderQueryBlockHtml('is:open', parseQueryBlockInfo('deckard group=priority')!, workspace(), { queryContext: context });
    assert.ok(list.includes('<div class="deckard-query-subgroup-title" role="heading" aria-level="4">Highest <span class="deckard-query-subgroup-count">· 1</span></div>'), list);
    assert.strictEqual((list.match(/<ul class="deckard-query-list">/g) ?? []).length, 4, 'a list for each group');
    const table = renderQueryBlockHtml('is:open', parseQueryBlockInfo('deckard view=table columns=due group=priority')!, workspace(), { queryContext: context });
    assert.ok(table.includes('<tbody><tr class="deckard-query-subgroup-row"><th scope="rowgroup" colspan="2">No priority <span class="deckard-query-subgroup-count">· 3</span></th></tr>'), table);
    const plain = renderQueryBlockHtml('is:open', parseQueryBlockInfo('deckard')!, workspace(), { queryContext: context });
    assert.ok(!plain.includes('deckard-query-subgroup'), 'no group= draws one list, as before');
  });

  test('copies as plain Markdown with each group under its name', () => {
    const text = writeQueryBlock('is:open #project/atlas', parseQueryBlockInfo('deckard group=due')!, { index: workspace(), queryContext: context });
    assert.ok(text.startsWith('**Overdue · 1**\n\n- [ ] Chase the contractor'), text);
    assert.ok(text.includes('**No due date · 1**\n\n- [ ] Water the plants'), text);
  });

  test('writes group= into a live block, and the board\'s grouping as one', () => {
    assert.strictEqual(formatQueryBlock('is:open', { group: 'assignee', sort: 'due' }), '```deckard group=for sort=due\nis:open\n```\n');
    assert.strictEqual(queryBlockGroupOfBoard('tag', 'Context'), '#context');
    assert.strictEqual(queryBlockGroupOfBoard('tag', undefined), 'status');
    assert.strictEqual(queryBlockGroupOfBoard('due', undefined), 'due');
    const read = parseQueryBlockInfo('deckard group=for sort=due');
    assert.strictEqual(read?.group, 'assignee', 'and reads back as written');
  });
});
