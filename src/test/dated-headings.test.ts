import * as assert from 'assert';

import { datedRanges, isDatedHeading, readHeadingDate, withoutDatedEntries } from '../domain/markdown/datedHeadings';
import { parseMarkdown } from '../domain/markdown/parser';
import { entryIdOf, isEntrySection } from '../domain/markdown/noteEntries';
import type { ParsedFile } from '../domain/model';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { captureTagPageState, createSearchPageSnapshot } from '../ui/state/searchPageState';
import { compareTagPage, toTagVisit } from '../ui/state/sinceLastLooked';
import { createPreferences } from './preferenceServices';

/**
 * Dated headings (docs/implementation/49-meetings-and-types.md): a heading
 * that starts with a day begins an entry dated by that day, so a project's
 * note can hold its meetings and each is found and sorted by when it was.
 */
suite('Dated headings: a heading that starts with a day', () => {
  /** Local midnight on a day, or a time of day on it, written `10:00`. */
  const at = (year: number, month: number, day: number, time = '00:00'): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes).getTime();
  };

  const BOREALIS = [
    '---',
    'describes: project/borealis',
    '---',
    '# Borealis',
    'The cold-chain tracker for the northern depots.',
    '',
    '## People',
    'Priya leads; Dana runs the vendors.',
    '',
    '## 2026-11-09 Kickoff',
    'Agreed on two depots for the pilot.',
    '- [ ] Send the depot list @priya',
    '',
    '## 2026-11-16 10:00 Vendor sync @dana',
    'The sensors ship in December.',
    '### Pricing',
    'Per depot, not per sensor.',
    '- [ ] Ask about the spares next friday',
    '- [?] Is the gateway included?',
  ].join('\n');

  const parse = (content: string, path = 'projects/Borealis.md'): ParsedFile =>
    parseMarkdown(path, content, { createdAt: at(2026, 3, 2), updatedAt: at(2026, 11, 20) });
  const section = (file: ParsedFile, heading: string): ParsedFile['sections'][number] => {
    const found = file.sections.find((candidate) => candidate.heading.startsWith(heading));
    assert.ok(found, `no section ${heading}`);
    return found;
  };

  test('reads the day a heading starts with, and the time of day beside it', () => {
    assert.deepStrictEqual(readHeadingDate('2026-11-16 Vendor sync'), { day: '2026-11-16', at: at(2026, 11, 16) });
    assert.deepStrictEqual(readHeadingDate('2026-11-16 10:00 Vendor sync'), { day: '2026-11-16', time: '10:00', at: at(2026, 11, 16, '10:00') });
    assert.deepStrictEqual(readHeadingDate('2026-11-16 9:05'), { day: '2026-11-16', time: '09:05', at: at(2026, 11, 16, '09:05') });
    assert.deepStrictEqual(readHeadingDate('2026-11-16: Kickoff'), { day: '2026-11-16', at: at(2026, 11, 16) });
    assert.deepStrictEqual(readHeadingDate('2026-11-16'), { day: '2026-11-16', at: at(2026, 11, 16) });
  });

  test('a heading that only mentions a day, or starts with one no calendar has, is not dated', () => {
    assert.strictEqual(readHeadingDate('Vendor sync 2026-11-16'), undefined);
    assert.strictEqual(readHeadingDate('2026-13-40 Kickoff'), undefined);
    assert.strictEqual(readHeadingDate('2026-02-31 Kickoff'), undefined);
    assert.strictEqual(readHeadingDate('2026-11-161 budget lines'), undefined);
    assert.strictEqual(readHeadingDate('2026-11-16-retro'), undefined);
    assert.deepStrictEqual(readHeadingDate('2026-11-16 25:00 Late'), { day: '2026-11-16', at: at(2026, 11, 16) }, 'a time no clock has is left as words');
  });

  test('a dated heading and what is under it take its day, and the rest of the note keeps the note\'s', () => {
    const file = parse(BOREALIS);
    const kickoff = section(file, '2026-11-09 Kickoff');
    const sync = section(file, '2026-11-16 10:00 Vendor sync');
    const pricing = section(file, 'Pricing');
    assert.strictEqual(kickoff.dated, '2026-11-09');
    assert.strictEqual(kickoff.createdAt, at(2026, 11, 9));
    assert.strictEqual(kickoff.updatedAt, at(2026, 11, 9), 'not the day the note was last saved');
    assert.strictEqual(sync.createdAt, at(2026, 11, 16, '10:00'));
    assert.strictEqual(pricing.dated, '2026-11-16');
    assert.strictEqual(pricing.createdAt, at(2026, 11, 16, '10:00'));
    const people = section(file, 'People');
    assert.strictEqual(people.dated, undefined);
    assert.strictEqual(people.createdAt, at(2026, 3, 2));
    assert.ok(isDatedHeading(sync));
    assert.ok(!isDatedHeading(pricing), 'under a dated heading, not one itself');
  });

  test('a task and a question under a dated heading are from that day', () => {
    const file = parse(BOREALIS);
    const [depots, spares] = file.tasks;
    assert.strictEqual(depots.createdAt, at(2026, 11, 9));
    assert.strictEqual(depots.updatedAt, at(2026, 11, 9));
    assert.strictEqual(spares.createdAt, at(2026, 11, 16, '10:00'));
    assert.strictEqual(spares.dueAt, at(2026, 11, 20), 'the friday after the meeting, not the one after the note was saved');
    const question = (file.questions ?? []).find((asked) => asked.title.includes('gateway'));
    assert.strictEqual(question?.createdAt, at(2026, 11, 16, '10:00'));
  });

  test('a dated heading is an entry of its own, with the headings under it, in a note tagged in its front matter', () => {
    const file = parse(BOREALIS);
    const sync = section(file, '2026-11-16 10:00 Vendor sync');
    assert.ok(isEntrySection(sync));
    assert.strictEqual(entryIdOf(section(file, 'Pricing')), sync.id);
    assert.strictEqual(entryIdOf(section(file, 'People')), 'file:projects/Borealis.md');
    assert.strictEqual(file.tasks[1].entryId, sync.id);
  });

  test('a daily note has no dated entries: its day is already the day of everything in it', () => {
    const file = parseMarkdown('daily/2026-11-16.md', ['# 2026-11-16', '## 2026-11-12 Notes from last week', 'Late write-up.'].join('\n'), {
      createdAt: at(2026, 11, 16),
      updatedAt: at(2026, 11, 16),
    });
    assert.ok(file.sections.every((candidate) => candidate.dated === undefined));
  });

  test('the note without its dated entries keeps every other line where it was', () => {
    const file = parse(BOREALIS);
    assert.deepStrictEqual(datedRanges(file.sections), [
      { startLine: 10, endLine: 13 },
      { startLine: 14, endLine: 19 },
    ]);
    const kept = withoutDatedEntries(BOREALIS.split('\n'), file.sections);
    assert.strictEqual(kept[kept.length - 1], 'Priya leads; Dana runs the vendors.');
    assert.strictEqual(kept[6], '## People');
    const between = ['# Notes', '## 2026-11-09 Kickoff', 'Two depots.', '## Links', 'The tracker.'];
    const mixed = parseMarkdown('notes/mixed.md', between.join('\n'));
    assert.deepStrictEqual(withoutDatedEntries(between, mixed.sections), ['# Notes', '', '', '## Links', 'The tracker.']);
  });

  test('a tag\'s page draws the hub note down to its first meeting, and lists each meeting under its day', () => {
    const file = parse(BOREALIS);
    const other = parseMarkdown('daily/2026-11-12.md', '# 2026-11-12\n## Depot walk #project/borealis\nThe dock doors stick.', {
      createdAt: at(2026, 11, 12),
      updatedAt: at(2026, 11, 12),
    });
    const index = buildWorkspaceIndex(new Map([[file.filePath, file], [other.filePath, other]]));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.reader.value, '#project/borealis', { queryContext: createQueryContext(at(2026, 11, 20)) });
    const hub = snapshot.hub;
    assert.ok(hub, 'the hub is drawn');
    assert.ok(hub.rawContent.includes('Priya leads'));
    assert.ok(!hub.rawContent.includes('Kickoff'), 'the description stops at the first dated heading');
    assert.ok(!JSON.stringify(hub.blocks ?? []).includes('sensors ship'), 'and so do its blocks');
    const headings = snapshot.sections.map((card) => card.heading.replace(/ [#@].*/, ''));
    assert.deepStrictEqual([...headings].sort(), ['2026-11-09 Kickoff', '2026-11-16 10:00 Vendor sync', 'Depot walk']);
    assert.ok(!headings.includes('Pricing'), 'a heading under a meeting is part of it');
  });

  test('a meeting written into the hub note since the last visit is a new mention, and a new line of description is not', () => {
    const context = createQueryContext(at(2026, 11, 20));
    const indexOf = (content: string): ReturnType<typeof buildWorkspaceIndex> => {
      const file = parse(content);
      return buildWorkspaceIndex(new Map([[file.filePath, file]]));
    };
    const visit = toTagVisit(captureTagPageState(indexOf(BOREALIS), '#project/borealis', context), at(2026, 11, 17));
    const described = BOREALIS.replace('Priya leads;', 'Priya leads the pilot;');
    assert.strictEqual(compareTagPage(visit, captureTagPageState(indexOf(described), '#project/borealis', context)).newEntries.size, 0);
    const met = [BOREALIS, '## 2026-11-19 Depot walk', 'The dock doors stick.'].join('\n');
    assert.strictEqual(compareTagPage(visit, captureTagPageState(indexOf(met), '#project/borealis', context)).newEntries.size, 1);
  });
});
