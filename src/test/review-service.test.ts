import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { getReviewRange, parsePeriodicNoteName, ReviewPeriod, reviewPeriodOfNote } from '../domain/notes/reviewPeriods';
import { createQueryContext } from '../domain/query/queryContext';
import type { ResourceUri } from '../ports/uri';
import { ReviewCounts, ReviewNote, ReviewService, ReviewSummaryOptions } from '../services/reviewService';
import { formatReview, REVIEW_START, ReviewSummary, summarizeReview, writeReviewInto } from '../ui/state/reviewState';
import { fileUri } from './fakeWorkspace';

// ReviewService decides which days a review covers, what it looks ahead at,
// and whether its note needs writing; these run it over a note held in
// memory and a report that records what it was asked, so each outcome is a
// value to assert without VS Code.

const NOTE = fileUri('/ws/notes/week-2026-09-13-2026-09-19.md');
const index = buildWorkspaceIndex(new Map());

/** What the fakes saw, in the order they saw it. */
interface Seen {
  events: string[];
  summarized?: { range: ReviewPeriod; options: ReviewSummaryOptions };
  written?: { content: string; title: string };
}

/** A service over a note that reads `text`, whose write lands unless `applied` is false. */
function reviewsWith(options: { text?: string; applied?: boolean; refresh?: () => Promise<void> } = {}) {
  const seen: Seen = { events: [] };
  const summary: ReviewCounts = { completed: [1, 2], slipped: [3], comingUp: [] };
  const service = new ReviewService<ResourceUri, string, ReviewCounts>({
    notes: {
      open: (uri): Promise<ReviewNote<string>> => {
        seen.events.push(`open ${uri.path}`);
        return Promise.resolve({
          text: options.text ?? '# Week\n',
          write: (content, title) => {
            seen.written = { content, title };
            return Promise.resolve(options.applied === false ? { applied: false } : { applied: true, handle: 'handle' });
          },
        });
      },
    },
    report: {
      summarize: (_index, range, summaryOptions) => {
        seen.events.push('summarize');
        seen.summarized = { range, options: summaryOptions };
        return summary;
      },
      format: () => 'REVIEW',
      writeInto: (content, review) => (content.includes(review) ? content : `${content}\n${review}\n`),
    },
    index: {
      refresh: () => {
        seen.events.push('refresh');
        return options.refresh?.() ?? Promise.resolve();
      },
    },
  });
  return { service, seen, summary };
}

/** A request for the week of 2026-09-17, weeks starting on Sunday. */
function weekRequest(extra: { range?: ReviewPeriod } = {}) {
  return {
    index,
    period: 'week' as const,
    day: new Date(2026, 8, 17),
    weekStart: 0 as const,
    note: () => Promise.resolve(NOTE),
    sections: [{ title: 'Reading', query: '#book' }],
    queryContext: createQueryContext(0),
    tagFirstSeen: { '#new': 1 },
    ...extra,
  };
}

suite('ReviewService', () => {
  test('writes the week the day falls in, looking ahead at the next, and reads the notes again', async () => {
    const { service, seen, summary } = reviewsWith();

    const result = await service.write(weekRequest());

    assert.deepStrictEqual(result, {
      kind: 'written',
      title: '2026-09-13 to 2026-09-19',
      noteUri: NOTE,
      summary,
      handle: 'handle',
    });
    // The note is found only once the review is read out of the index.
    assert.deepStrictEqual(seen.events, ['summarize', `open ${NOTE.path}`, 'refresh']);
    assert.deepStrictEqual(seen.summarized?.range, getReviewRange('week', new Date(2026, 8, 17), 0));
    assert.strictEqual(seen.summarized?.options.next.title, '2026-09-20 to 2026-09-26');
    assert.strictEqual(seen.summarized?.options.nextLabel, 'next week');
    assert.deepStrictEqual(seen.summarized?.options.sections, [{ title: 'Reading', query: '#book' }]);
    assert.deepStrictEqual(seen.summarized?.options.tagFirstSeen, { '#new': 1 });
    assert.deepStrictEqual(seen.written, { content: '# Week\n\nREVIEW\n', title: '2026-09-13 to 2026-09-19' });
  });

  test('reviews a note for the days its own name holds', async () => {
    const { service, seen } = reviewsWith();
    const name = '2026-W38';
    const range = reviewPeriodOfNote(parsePeriodicNoteName(name)!, name);

    const result = await service.write(weekRequest({ range }));

    assert.strictEqual(result.kind === 'written' && result.title, '2026-09-14 to 2026-09-20');
    assert.strictEqual(seen.summarized?.range, range);
    // Weeks start on Sunday here, but the week looked ahead at starts the
    // day after the note's own last day, so no day is in both.
    assert.strictEqual(seen.summarized?.options.next.title, '2026-09-21 to 2026-09-27', 'the week after its last day');
    assert.strictEqual(seen.summarized?.options.next.start, range?.end);
  });

  test('looks ahead at next month from a month', async () => {
    const { service, seen } = reviewsWith();
    await service.write({ ...weekRequest(), period: 'month' });
    assert.strictEqual(seen.summarized?.range.title, '2026-09-01 to 2026-09-30');
    assert.strictEqual(seen.summarized?.options.nextLabel, 'next month');
    assert.strictEqual(seen.summarized?.options.next.title, '2026-10-01 to 2026-10-31');
  });

  test('writes nothing when the note already holds this review', async () => {
    const { service, seen } = reviewsWith({ text: '# Week\n\nREVIEW\n' });
    assert.deepStrictEqual(await service.write(weekRequest()), {
      kind: 'unchanged',
      title: '2026-09-13 to 2026-09-19',
      noteUri: NOTE,
    });
    assert.strictEqual(seen.written, undefined);
    assert.ok(!seen.events.includes('refresh'));
  });

  test('reports a write VS Code did not apply, and reads nothing again', async () => {
    const { service, seen } = reviewsWith({ applied: false });
    assert.deepStrictEqual(await service.write(weekRequest()), { kind: 'not-applied' });
    assert.ok(!seen.events.includes('refresh'));
  });

  test('still reports the review when the notes cannot be read again', async () => {
    const { service } = reviewsWith({ refresh: () => Promise.reject(new Error('index busy')) });
    assert.strictEqual((await service.write(weekRequest())).kind, 'written');
  });

  test('a CRLF note is written in its own line endings, and holds the review as it would be written', async () => {
    let text = '# 2026-09-13 to 2026-09-19\r\n\r\nNotes.\r\n';
    const handed: string[] = [];
    const service = new ReviewService<ResourceUri, number, ReviewSummary>({
      notes: {
        open: () =>
          Promise.resolve({
            text,
            write: (content) => {
              handed.push(content);
              // VS Code writes an edit into a CRLF document in CRLF.
              text = content.replace(/\r?\n/g, '\r\n');
              return Promise.resolve({ applied: true, handle: handed.length });
            },
          }),
      },
      report: { summarize: summarizeReview, format: formatReview, writeInto: writeReviewInto },
      index: { refresh: () => Promise.resolve() },
    });

    assert.strictEqual((await service.write(weekRequest())).kind, 'written');
    assert.ok(handed[0].includes(REVIEW_START));
    assert.doesNotMatch(handed[0], /[^\r]\n/, 'every line ends in CRLF');
    assert.strictEqual((await service.write(weekRequest())).kind, 'unchanged');
    assert.strictEqual(handed.length, 1, 'written once');
  });
});

suite('Periodic note names', () => {
  test('reads each name Deckard has given a periodic note, from a table', () => {
    const read = (name: string) => {
      const found = parsePeriodicNoteName(name);
      return found && [found.period, found.day.getTime(), found.name];
    };
    assert.deepStrictEqual(read('week-2026-09-13-2026-09-19'), ['week', new Date(2026, 8, 13).getTime(), 'week-2026-09-13-2026-09-19']);
    assert.deepStrictEqual(read('month-September-2026'), ['month', new Date(2026, 8, 1).getTime(), undefined]);
    assert.deepStrictEqual(read('2026-W38'), ['week', new Date(2026, 8, 14).getTime(), '2026-W38']);
    assert.deepStrictEqual(read('2026-09'), ['month', new Date(2026, 8, 1).getTime(), undefined]);
    for (const other of ['', '2026-09-13', 'month-smarch-2026', 'week-2026-02-30-2026-03-06', 'Atlas']) {
      assert.strictEqual(parsePeriodicNoteName(other), undefined, other);
    }
  });

  test('says which days a note holds only when its name says them', () => {
    const month = parsePeriodicNoteName('2026-09');
    assert.strictEqual(month && reviewPeriodOfNote(month, '2026-09'), undefined);
    const week = parsePeriodicNoteName('week-2026-09-13-2026-09-19');
    assert.deepStrictEqual(week && reviewPeriodOfNote(week, 'ignored'), {
      name: 'week-2026-09-13-2026-09-19',
      title: '2026-09-13 to 2026-09-19',
      start: new Date(2026, 8, 13).getTime(),
      end: new Date(2026, 8, 20).getTime(),
    });
  });
});
