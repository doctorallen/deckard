import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { formatLocalDate } from '../ui/commands/dailyNote';
import {
  findOpenPeriod,
  getIsoWeekStart,
  getReviewRange,
} from '../ui/commands/review';
import {
  formatReview,
  REVIEW_END,
  REVIEW_START,
  summarizeReview,
  writeReviewInto,
} from '../ui/state/reviewState';
import { createQueryContext } from '../domain/query/queryContext';

const DAY = 24 * 60 * 60 * 1000;
/** Monday 2026-09-14 to Sunday 2026-09-20. */
const range = {
  name: 'week-2026-09-14-2026-09-20',
  title: '2026-09-14 to 2026-09-20',
  start: new Date(2026, 8, 14).getTime(),
  end: new Date(2026, 8, 21).getTime(),
};

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

const index = indexOf({
  'notes/2026-09-15.md': [
    '---',
    'created: 2026-09-15',
    'updated: 2026-09-15',
    '---',
    '# 2026-09-15',
    '',
    '- [x] Send the proposal #project/atlas ✅ 2026-09-16',
    '- [ ] Chase the contractor 📅 2026-09-17',
    '- [x] Filed last month ✅ 2026-08-30',
  ].join('\n'),
  'notes/Vendor review.md': [
    '---',
    'created: 2026-09-16',
    'updated: 2026-09-16',
    '---',
    '# Vendor review #risk/vendor',
    '',
    '- [ ] Read the survey 📅 2026-10-30',
  ].join('\n'),
  'notes/Atlas.md': [
    '---',
    'created: 2026-01-04',
    'updated: 2026-09-18',
    '---',
    '# Atlas #project/atlas',
  ].join('\n'),
  'notes/Old.md': [
    '---',
    'created: 2025-05-05',
    'updated: 2025-05-05',
    '---',
    '# Old',
  ].join('\n'),
});

suite('Periodic review', () => {
  test('reads the week out of the index', () => {
    const summary = summarizeReview(index, range, {
      queryContext: createQueryContext(Date.now()),
      tagFirstSeen: {
        '#risk/vendor': new Date(2026, 8, 16).getTime(),
        '#project/atlas': new Date(2026, 0, 4).getTime(),
        '#gone/away': new Date(2026, 8, 17).getTime(),
      },
    });
    assert.deepStrictEqual(
      summary.completed.map((item) => [item.title, item.detail]),
      [['Send the proposal', 'done 2026-09-16']],
      'a task completed in another month is not this week',
    );
    assert.deepStrictEqual(
      summary.slipped.map((item) => item.title),
      ['Chase the contractor'],
      'due by the end of the week and still open; October is not yet late',
    );
    assert.deepStrictEqual(
      summary.created.map((item) => item.title),
      ['2026-09-15', 'Vendor review'],
    );
    assert.deepStrictEqual(
      summary.updated.map((item) => item.title),
      ['Atlas'],
      'a note written earlier and changed this week is changed, not written',
    );
    assert.deepStrictEqual(
      summary.newTags,
      ['#risk/vendor'],
      'a tag first seen this week, and only one the index still has',
    );
  });

  test('writes it as Markdown that carries no tags of its own', () => {
    const review = formatReview(
      summarizeReview(index, range, {
        queryContext: createQueryContext(Date.now()),
        tagFirstSeen: { '#risk/vendor': new Date(2026, 8, 16).getTime() },
      }),
    );
    assert.ok(review.startsWith(REVIEW_START), review);
    assert.ok(review.endsWith(REVIEW_END));
    assert.ok(
      review.includes('## Review of 2026-09-14 to 2026-09-20'),
      'a review is named by the days it covers, not by a week number',
    );
    assert.ok(
      review.includes('*week-2026-09-14-2026-09-20.'),
      'the note it is written in still says which it is',
    );
    assert.ok(review.includes('**Done:** 1 (0 of 1 that were due) · **Still open:** 1 · **Coming up:** 0'), review);
    assert.ok(review.includes('- Send the proposal — [[2026-09-15]] (done 2026-09-16)'));

    const drawn = parseMarkdown('notes/2026-W38.md', review);
    assert.deepStrictEqual(
      drawn.sections.flatMap((section) => section.tags),
      [],
      'a review is about those tags, so it carries none of them',
    );
    assert.strictEqual(
      drawn.tasks.length,
      0,
      'the tasks it lists are read, not written again as tasks',
    );
  });

  test('looks ahead at the next week, each task once, by its earliest day', () => {
    const next = {
      name: 'week-2026-09-21-2026-09-27',
      title: '2026-09-21 to 2026-09-27',
      start: new Date(2026, 8, 21).getTime(),
      end: new Date(2026, 8, 28).getTime(),
    };
    const ahead = indexOf({
      'notes/2026-09-19.md': [
        '# 2026-09-19',
        '- [ ] Call Ren 📅 2026-09-24 ⏳ 2026-09-22',
        '- [ ] Book the room 📅 2026-09-21',
        '- [ ] Later still 📅 2026-10-15',
        '- [x] Done already 📅 2026-09-22 ✅ 2026-09-19',
        '- [ ] Starts then 🛫 2026-09-26',
      ].join('\n'),
    });
    const summary = summarizeReview(ahead, range, { queryContext: createQueryContext(Date.now()), next, nextLabel: 'next week' });
    assert.deepStrictEqual(
      summary.comingUp.map((item) => [item.title, item.detail]),
      [
        ['Mon 2026-09-21 · Book the room', 'due'],
        ['Tue 2026-09-22 · Call Ren', 'scheduled'],
        ['Sat 2026-09-26 · Starts then', 'starts'],
      ],
    );
    const review = formatReview(summary);
    assert.ok(review.includes('### Coming up'), review);
    assert.ok(review.includes('- Mon 2026-09-21 · Book the room — [[2026-09-19]] (due)'), review);
    assert.ok(
      formatReview(summarizeReview(indexOf({}), range, { queryContext: createQueryContext(Date.now()), next, nextLabel: 'next week' })).includes(
        'Nothing is due, scheduled, or starting next week.',
      ),
    );
  });

  test('writes sections of your own, and says when a search does not parse', () => {
    const review = formatReview(
      summarizeReview(index, range, { queryContext: createQueryContext(Date.now()),
        sections: [
          { title: 'Open for Atlas', query: '#project/atlas is:open' },
          { title: 'Broken', query: '(is:open' },
        ],
      }),
    );
    assert.ok(review.includes('### Open for Atlas'), review);
    assert.ok(review.includes('### Broken\n\nThis search does not parse:'), review);
    assert.ok(review.indexOf('### Open for Atlas') < review.indexOf(REVIEW_END));
  });

  test('says so when a period held nothing', () => {
    const review = formatReview(
      summarizeReview(indexOf({}), range, { queryContext: createQueryContext(Date.now()) }),
    );
    assert.ok(review.includes('Nothing was completed in this period.'));
    assert.ok(review.includes('No tags were first seen in this period.'));
  });

  test('replaces the review already in a note, and nothing else', () => {
    const note = '# 2026-W38\n\nMy own notes stay.\n';
    const first = writeReviewInto(note, `${REVIEW_START}\nfirst\n${REVIEW_END}`);
    assert.strictEqual(
      first,
      '# 2026-W38\n\nMy own notes stay.\n\n<!-- deckard:review -->\nfirst\n<!-- deckard:review:end -->\n',
    );
    const second = writeReviewInto(
      `${first}\n\nWritten after the review.\n`,
      `${REVIEW_START}\nsecond\n${REVIEW_END}`,
    );
    assert.ok(second.includes('My own notes stay.'));
    assert.ok(second.includes('Written after the review.'));
    assert.ok(second.includes('second'));
    assert.ok(!second.includes('first'));
  });

  test('knows which days a week and a month cover', () => {
    // A week is the Calendar's row: Sunday to Saturday, and named for it.
    const week = getReviewRange('week', new Date(2026, 8, 17));
    assert.strictEqual(week.name, 'week-2026-09-13-2026-09-19');
    assert.strictEqual(week.title, '2026-09-13 to 2026-09-19');
    assert.strictEqual(new Date(week.start).getDay(), 0, 'Sunday');
    assert.strictEqual(week.end - week.start, 7 * DAY);

    const month = getReviewRange('month', new Date(2026, 8, 17));
    assert.strictEqual(month.name, 'month-september-2026');
    assert.strictEqual(month.title, '2026-09-01 to 2026-09-30');
    assert.strictEqual(new Date(month.start).getDate(), 1);
    assert.strictEqual(new Date(month.end).getMonth(), 9, 'October starts it');

    assert.strictEqual(getIsoWeekStart(2026, 38).getDate(), 14);

    // With weeks starting on Monday, the week is Monday to Sunday.
    assert.strictEqual(getReviewRange('week', new Date(2026, 8, 17), 1).title, '2026-09-14 to 2026-09-20');
  });

  test('a week note is reviewed for the days its own name holds', () => {
    const span = (name: string) => {
      const found = findOpenPeriod(name);
      return found && [formatLocalDate(found.start!), formatLocalDate(found.end!)];
    };
    assert.deepStrictEqual(span('week-2026-09-20-2026-09-26'), ['2026-09-20', '2026-09-27']);
    assert.deepStrictEqual(span('2026-W39'), ['2026-09-21', '2026-09-28']);
  });

  test('reads which period a note is for from its name', () => {
    const period = (name: string) => {
      const found = findOpenPeriod(name);
      return found && [found.period, formatLocalDate(found.day)];
    };
    assert.deepStrictEqual(period('week-2026-09-13-2026-09-19'), [
      'week',
      '2026-09-13',
    ]);
    assert.deepStrictEqual(period('month-september-2026'), ['month', '2026-09-01']);
    // The names Deckard wrote before still say which period they are for.
    assert.deepStrictEqual(period('2026-W38'), ['week', '2026-09-14']);
    assert.deepStrictEqual(period('2026-09'), ['month', '2026-09-01']);
    assert.strictEqual(findOpenPeriod('2026-09-13'), undefined, 'a daily note');
    assert.strictEqual(findOpenPeriod('Atlas'), undefined);
  });

  test('writes the review into the note on disk', async () => {
    const directoryName = `deckard-review-${Date.now()}`;
    const root = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, '2026-W38.md');
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from('# 2026-W38\n\nWhat I meant to do.\n', 'utf8'),
    );
    const review = formatReview(summarizeReview(index, range, { queryContext: createQueryContext(Date.now()) }));
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(
        writeReviewInto(
          Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),
          review,
        ),
        'utf8',
      ),
    );
    const written = Buffer.from(
      await vscode.workspace.fs.readFile(uri),
    ).toString('utf8');
    assert.ok(written.startsWith('# 2026-W38\n\nWhat I meant to do.'));
    assert.ok(written.includes('## Review of 2026-09-14 to 2026-09-20'));
    await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
  });
});
