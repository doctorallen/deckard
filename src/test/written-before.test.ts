import * as assert from 'assert';
import { performance } from 'perf_hooks';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { ParsedFile, WorkspaceIndex } from '../domain/model';
import { getLineIndex } from '../domain/ranking/lineIndex';
import {
  countLineWords,
  describeWrittenBeforeHint,
  findWrittenBefore,
  linkItHere,
  notSameKey,
  WRITTEN_BEFORE_MIN_SCORE,
  type WrittenLine,
} from '../domain/ranking/writtenBefore';
import { createRandom, pick } from './indexCorpus';
import type { SidebarWrittenBefore } from '../ui/protocol/sidebarNotes';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/** The moment the tests ask at: 14 October 2026, at noon. */
const NOW = new Date(2026, 9, 14, 12).getTime();

/** An index of notes, by path and text; a daily note is dated by its name. */
function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, text]): [string, ParsedFile] => [filePath, parseMarkdown(filePath, text)])),
  );
}

/** The line being written today, in today's note, under the rates desk. */
const WRITING: WrittenLine = {
  text: '- The curve feed lagged again this morning after the loader restarted',
  filePath: 'notes/2026-10-14.md',
  tags: ['#team/rates'],
};

/**
 * Two hundred lines of a month of notes about other things, so the words
 * the tests share are as rare among them as in a workspace of notes.
 */
const OTHER_LINES = Array.from({ length: 200 }, (_, at) => `- Offsite item ${at}: rooms, catering, and the agenda for ${['Monday', 'Tuesday', 'Wednesday', 'Thursday'][at % 4]}`).join('\n');

suite('You\'ve written this before: what counts as a match', () => {
  const index = indexOf({
    'notes/offsite.md': `# Offsite\n${OTHER_LINES}\n`,
    'notes/2026-10-14.md': `# 2026-10-14\n## Rates desk #team/rates\n${WRITING.text}\n`,
    'notes/2026-03-12.md': '# 2026-03-12\n## Rates desk standup #team/rates\n- Same lag in the curve feed, fixed by restarting the loader\n',
    'notes/2026-02-01.md': '# 2026-02-01\n- Curve feed loader lag seen again in the FX book\n',
    'notes/2026-10-13.md': '# 2026-10-13\n- The curve feed lagged after the loader restarted yesterday\n',
    'notes/2026-01-05.md': '# 2026-01-05\n- The curve was flat and the feed was quiet all day\n',
  });
  const find = (line: WrittenLine = WRITING, rejected: ReadonlySet<string> = new Set()) =>
    findWrittenBefore(index, line, { now: NOW, rejected });

  test('an older line of another note sharing three uncommon words, its tag ranking it higher; at most two', () => {
    const found = find();
    assert.deepStrictEqual(found.map((match) => [match.filePath, match.line, match.text]), [
      ['notes/2026-03-12.md', 3, 'Same lag in the curve feed, fixed by restarting the loader'],
      ['notes/2026-02-01.md', 2, 'Curve feed loader lag seen again in the FX book'],
    ]);
    assert.deepStrictEqual(found[0].sharedTags, ['#team/rates'], 'both tagged #team/rates');
    assert.deepStrictEqual(found[1].sharedTags, []);
    assert.ok(found[0].shared.includes('curve') && found[0].shared.includes('loader'));
  });

  test('never the same note, nor a line written in the last two days', () => {
    const paths = find().map((match) => match.filePath);
    assert.ok(!paths.includes('notes/2026-10-14.md'), 'the same note, which holds the line itself');
    assert.ok(!paths.includes('notes/2026-10-13.md'), 'yesterday');
  });

  test('a line of fewer than six words is compared with nothing', () => {
    assert.strictEqual(countLineWords('- [ ] Curve feed loader lag #team/rates [[Atlas]]'), 4);
    assert.deepStrictEqual(find({ ...WRITING, text: '- Curve feed loader lag again' }), []);
  });

  test('a line sharing only two uncommon words is no match', () => {
    assert.ok(!find().some((match) => match.filePath === 'notes/2026-01-05.md'));
  });

  test('Not the same sets a pair aside for good', () => {
    const [first] = find();
    const rejected = new Set([notSameKey(WRITING.text, first)]);
    assert.deepStrictEqual(find(WRITING, rejected).map((match) => match.filePath), ['notes/2026-02-01.md']);
    assert.strictEqual(notSameKey('* The curve feed  lagged again this morning after the loader restarted', first), first.key, 'kept by the line\'s words');
  });

  test('Link it here appends a link to the older line, and the hint is cut to fit', () => {
    assert.strictEqual(
      linkItHere('- The curve feed lagged again  ', '[[2026-03-12#Rates desk standup]]'),
      '- The curve feed lagged again (see [[2026-03-12#Rates desk standup]])',
    );
    const hint = describeWrittenBeforeHint({ text: 'same lag, fixed by restarting the curve loader before the open, and then again at noon' }, '12 Mar');
    assert.strictEqual(hint.length, 60);
    assert.match(hint, /^↺ 12 Mar: same lag, fixed by restarting the curve loader.*…$/);
    assert.strictEqual(describeWrittenBeforeHint({ text: 'anything' }, '12 Mar', true), '↺', 'Zen keeps the mark alone');
  });
});

suite('You\'ve written this before: the score threshold', () => {
  /**
   * Sixty lines: one older line sharing three words no other line writes,
   * and one sharing three words five lines each write, one line in twelve.
   * Both share three uncommon words; only the first clears the threshold.
   */
  const filler = Array.from({ length: 50 }, (_, at) => `- Filler line ${at} about the quarterly offsite planning ${at % 5 === 0 ? 'margin hedge basis' : 'ledger'}`);
  const index = indexOf({
    'notes/filler.md': `# Filler\n${filler.join('\n')}\n`,
    'notes/rare.md': '# Rare\n- Zebra quokka narwhal sighting written up for the zoo\n',
  });
  const line = (text: string): WrittenLine => ({ text, filePath: 'notes/today.md', tags: [] });

  test('three words only these lines write clear it; three that five lines each write do not', () => {
    const rare = findWrittenBefore(index, line('- Another zebra quokka narwhal sighting near the gate today'), { now: NOW, rejected: new Set() });
    assert.deepStrictEqual(rare.map((match) => match.filePath), ['notes/rare.md']);
    assert.ok(rare[0].score >= WRITTEN_BEFORE_MIN_SCORE, `${rare[0].score} clears ${WRITTEN_BEFORE_MIN_SCORE}`);
    const common = findWrittenBefore(index, line('- Reviewed the margin hedge basis numbers with finance'), { now: NOW, rejected: new Set() });
    assert.deepStrictEqual(common, []);
  });
});

suite('You\'ve written this before: how long ranking takes', () => {
  test('ranks one line in under 15 ms on a 3,000-note workspace', function () {
    this.timeout(120000);
    const random = createRandom(39);
    // A vocabulary whose words are written as often as a language writes
    // them: the first few on many lines, most on very few.
    const vocabulary = Array.from({ length: 6000 }, (_, at) => `w${at.toString(36)}x`);
    const weighted = vocabulary.flatMap((word, rank) => Array.from({ length: Math.max(1, Math.round(400 / (rank + 1))) }, () => word));
    const lineOf = (): string => `- ${Array.from({ length: 8 + Math.floor(random() * 8) }, () => pick(random, random() < 0.5 ? weighted : vocabulary)).join(' ')}`;
    const notes: Record<string, string> = {};
    for (let note = 0; note < 3000; note += 1) {
      const day = new Date(2025, 0, 1 + (note % 600));
      const name = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      notes[`notes/n${note}-${name}.md`] = `# Note ${note}\n## Part #topic/t${note % 40}\n${Array.from({ length: 30 }, lineOf).join('\n')}\n`;
    }
    const index = indexOf(notes);
    // The line index is built once, on first use, outside the ranking timed.
    getLineIndex(index);
    const lines = Array.from({ length: 30 }, () => ({ text: lineOf(), filePath: 'notes/today.md', tags: ['#topic/t1'] }));
    const timings = lines.map((line) => {
      const start = performance.now();
      findWrittenBefore(index, line, { now: NOW, rejected: new Set() });
      return performance.now() - start;
    });
    const median = [...timings].sort((left, right) => left - right)[Math.floor(timings.length / 2)];
    assert.ok(median < 15, `the median line took ${median.toFixed(2)} ms`);
  });
});

suite('You\'ve written this before: Context', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const open = (writtenBefore?: SidebarWrittenBefore[]): WebviewPage => {
    page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: '2026-10-14.md',
      activeTags: [],
      notes: [],
      state: 'noMatches',
      parkedTags: [],
      ...(writtenBefore ? { writtenBefore } : {}),
    });
    return page;
  };

  const MATCH: SidebarWrittenBefore = {
    filePath: 'notes/2026-03-12.md',
    line: 3,
    text: 'Same lag in the curve feed, fixed by restarting the loader',
    where: 'Thu, Mar 12 · Rates desk standup',
    shares: 'Shares curve, feed, loader · both tagged #team/rates',
    terms: ['curve', 'feed', 'loader'],
  };

  test('lists the older lines above the related notes, each with what it shares, Link it here, and Not the same', () => {
    const shown = open([MATCH]);
    assert.strictEqual(shown.text('.written-before .section-label'), 'Written before');
    assert.strictEqual(shown.text('.written-before-card .note-title'), 'Thu, Mar 12 · Rates desk standup');
    assert.strictEqual(shown.text('.written-before-card .written-before-shares'), 'Shares curve, feed, loader · both tagged #team/rates');
    assert.deepStrictEqual(shown.findAll('.written-before-card mark').map((mark) => mark.textContent), ['curve', 'feed', 'loader'], 'the shared words are marked');
    shown.click('.written-before-card [data-action="written-before-link-here"]');
    assert.deepStrictEqual(shown.lastPosted('writtenBeforeAction'), { type: 'writtenBeforeAction', action: 'linkHere', filePath: 'notes/2026-03-12.md', line: 3 });
    shown.click('.written-before-card [data-action="written-before-not-same"]');
    assert.deepStrictEqual(shown.lastPosted('writtenBeforeAction'), { type: 'writtenBeforeAction', action: 'notSame', filePath: 'notes/2026-03-12.md', line: 3 });
    shown.click('.written-before-card .note-excerpt');
    assert.deepStrictEqual(shown.lastPosted('writtenBeforeAction'), { type: 'writtenBeforeAction', action: 'open', filePath: 'notes/2026-03-12.md', line: 3 });
  });

  test('is absent when the line has no older line like it', () => {
    assert.strictEqual(open().document.querySelector('.written-before'), null);
  });
});
