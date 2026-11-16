import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { readHeadingDate } from '../domain/markdown/datedHeadings';
import type { WorkspaceIndex } from '../domain/model';
import {
  formatMeetingHeading,
  formatMeetingLink,
  formatMeetingTime,
  listMeetingNotes,
  listMeetingSubjects,
  MeetingPick,
  orderPicks,
  placeMeeting,
  planMeeting,
} from '../domain/notes/meetings';

/**
 * Start a Meeting (docs/implementation/49-meetings-and-types.md): what a
 * meeting is offered to be about, where it is written, and its heading.
 */
suite('Start a Meeting', () => {
  /** A local time on a day of November 2026. */
  const at = (day: number, time = '00:00'): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(2026, 10, day, hours, minutes).getTime();
  };

  /** Notes, each last written on a day of November 2026. */
  const indexOf = (notes: Record<string, { day: number; text: string[] }>): WorkspaceIndex =>
    buildWorkspaceIndex(
      new Map(
        Object.entries(notes).map(([filePath, { day, text }]) => [
          filePath,
          parseMarkdown(filePath, text.join('\n'), { createdAt: at(1), updatedAt: at(day) }),
        ]),
      ),
    );

  const index = indexOf({
    'journal/2026-11-13.md': {
      day: 13,
      text: ['# 2026-11-13', '## Vendor sync #project/borealis @dana', 'The gateway is included.', '## Standup #project/atlas', '#urgent'],
    },
    'journal/2026-11-02.md': { day: 2, text: ['# 2026-11-02', '## Planning #project/atlas @priya', 'Two depots.'] },
    'projects/Borealis.md': {
      day: 3,
      text: ['---', 'describes: project/borealis', '---', '# Borealis', 'The cold-chain tracker.', '', '## 2026-11-12 Kickoff', 'Agreed.'],
    },
    'Weekly staff.md': { day: 3, text: ['# Weekly staff', '', '## 2026-11-05 10:00', '### Atlas #project/atlas', 'On track.', '', '## 2026-11-12 10:00', 'Short.'] },
    'Old retro.md': { day: 3, text: ['# Old retro', '', '## 2026-08-01', 'Long ago.'] },
  });
  const now = at(16, '09:58');

  test('offers the people and projects written about most lately, with their hub notes', () => {
    const subjects = listMeetingSubjects(index, now);
    assert.deepStrictEqual(
      subjects.map(({ tag, hubPath }) => [tag.label, hubPath]),
      [
        ['#project/atlas', undefined],
        ['#project/borealis', 'projects/Borealis.md'],
        ['@dana', undefined],
        ['@priya', undefined],
      ],
      'a tag in a namespace or a person, never a bare #urgent; the hub note\'s own meetings count for its tag',
    );
    assert.ok(subjects[0].score > subjects[1].score && subjects[2].score > subjects[3].score);
    assert.deepStrictEqual(listMeetingSubjects(index, now, 1).map(({ tag }) => tag.key), ['#project/atlas']);
    assert.deepStrictEqual(listMeetingSubjects(index, at(16) + 400 * 24 * 60 * 60 * 1000), [], 'nothing written lately, nothing offered');
  });

  test('offers the notes that hold meetings, the latest held first, and never a hub note', () => {
    assert.deepStrictEqual(listMeetingNotes(index, now), [
      { filePath: 'Weekly staff.md', title: 'Weekly staff', lastDay: '2026-11-12' },
    ]);
  });

  test('keeps picks in the order they were made, and the first is the meeting\'s home', () => {
    assert.deepStrictEqual(orderPicks(['a'], ['a', 'b']), ['a', 'b']);
    assert.deepStrictEqual(orderPicks(['b', 'a'], ['a', 'b', 'c']), ['b', 'a', 'c'], 'not the order the list holds them in');
    assert.deepStrictEqual(orderPicks(['b', 'a', 'c'], ['a', 'c']), ['a', 'c']);

    const borealis: MeetingPick = { kind: 'subject', tag: { key: '#project/borealis', label: '#project/borealis' }, hubPath: 'projects/Borealis.md' };
    const priya: MeetingPick = { kind: 'subject', tag: { key: '@priya', label: '@priya' } };
    assert.deepStrictEqual(planMeeting([borealis, priya, { kind: 'note', filePath: 'Weekly staff.md' }, priya]), {
      home: borealis,
      tags: [{ key: '@priya', label: '@priya' }],
    });
    assert.deepStrictEqual(planMeeting([{ kind: 'today' }, borealis, priya]).tags.map((tag) => tag.label), ['#project/borealis', '@priya']);
    assert.deepStrictEqual(planMeeting([]), { home: { kind: 'today' }, tags: [] }, 'nothing picked is no one thing');
  });

  test('heads a meeting with its day, its time to five minutes, its name, and its tags', () => {
    const tags = [{ key: '#project/borealis', label: '#project/borealis' }, { key: '@priya', label: '@priya' }];
    assert.strictEqual(formatMeetingTime(now), '10:00');
    assert.strictEqual(formatMeetingTime(at(16, '14:07')), '14:05');
    const heading = formatMeetingHeading({ now, name: ' Vendor  sync @priya ', tags, daily: false });
    assert.strictEqual(heading, '2026-11-16 10:00 Vendor sync @priya #project/borealis', 'a tag the name writes is not written twice');
    assert.deepStrictEqual(readHeadingDate(heading), { day: '2026-11-16', time: '10:00', at: at(16, '10:00') });
    assert.strictEqual(formatMeetingHeading({ now, name: 'Vendor sync', tags, daily: true }), '10:00 Vendor sync #project/borealis @priya');
    assert.strictEqual(formatMeetingHeading({ now, name: '', tags: [], daily: false }), '2026-11-16 10:00');
    assert.strictEqual(formatMeetingHeading({ now: at(16, '23:58'), name: '', tags: [], daily: false }), '2026-11-17 00:00');
  });

  test('writes the heading at the end of its note, and a link to it for today\'s note', () => {
    assert.deepStrictEqual(placeMeeting('# Borealis\nThe cold-chain tracker.\n\n\n', '2026-11-16 10:00 Vendor sync'), {
      start: { line: 1, character: 23 },
      end: { line: 4, character: 0 },
      text: '\n\n## 2026-11-16 10:00 Vendor sync\n\n',
      cursorLine: 5,
    });
    assert.deepStrictEqual(placeMeeting('', '10:00'), {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      text: '## 10:00\n\n',
      cursorLine: 2,
    });
    assert.strictEqual(placeMeeting('# Borealis\r\n', '10:00').text, '\r\n\r\n## 10:00\r\n\r\n');
    const link = { heading: '2026-11-16 10:00 Vendor sync @priya', time: '10:00', todayPath: 'journal/2026-11-16.md', homePath: 'projects/Borealis.md' };
    assert.strictEqual(formatMeetingLink({ ...link, style: 'wiki' }), '- 10:00 [[Borealis#2026-11-16 10:00 Vendor sync]]');
    assert.strictEqual(
      formatMeetingLink({ ...link, style: 'markdown' }),
      '- 10:00 [Borealis#2026-11-16 10:00 Vendor sync](../projects/Borealis.md#2026-11-16-1000-vendor-sync)',
    );
  });
});
