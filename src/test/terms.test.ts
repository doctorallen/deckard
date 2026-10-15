import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { ParsedFile, WorkspaceIndex } from '../domain/model';
import {
  buildTermTable,
  findTermSpans,
  getTermTable,
  isTermShape,
  matchesInitials,
  readInlineDefinitions,
  readTermQuestion,
} from '../domain/terms/terms';
import { listAnswerItems } from '../ui/state/findAnswers';

const lines = (...text: string[]): string => text.join('\n');

/** A note written on a day: `2026-03-03` is that day's morning. */
function noteOn(filePath: string, day: string, content: string): ParsedFile {
  const at = new Date(`${day}T09:00:00`).getTime();
  return parseMarkdown(filePath, content, { createdAt: at, updatedAt: at });
}

/** The index of these notes, each written on its day. */
function indexOf(notes: Array<[string, string, string]>): WorkspaceIndex {
  return buildWorkspaceIndex(new Map(notes.map(([filePath, day, content]) => [filePath, noteOn(filePath, day, content)])));
}

/** The terms of a line, as written. */
const termsIn = (text: string): string[] => findTermSpans(text).map((span) => span.term);

suite('Terms', () => {
  test('a term is two to six capitals and digits, or up to twelve with hyphens, with a letter', () => {
    for (const term of ['UAT', 'NDF', 'Q3', '3DS', 'RATES-UAT', 'INC-42']) {
      assert.ok(isTermShape(term), term);
    }
    for (const token of ['A', 'ABCDEFG', '2026', '2026-W38', 'RATES-UAT-EMEA', 'Uat']) {
      assert.ok(!isTermShape(token), token);
    }
  });

  test('finds terms in a line, but not in code, links, web addresses, tags, or a shouted line', () => {
    assert.deepStrictEqual(termsIn('UAT sign-off for RATES-UAT, then NDF.'), ['UAT', 'RATES-UAT', 'NDF']);
    assert.deepStrictEqual(termsIn('OK, TODO: ask the US team about JAN at 9 AM'), []);
    assert.deepStrictEqual(termsIn('See `UAT`, [[UAT plan]], [notes](UAT.md), #UAT, @UAT and https://example.com/UAT'), []);
    assert.deepStrictEqual(termsIn('UATs and path/UAT and file.UAT stay words'), []);
    assert.deepStrictEqual(termsIn('URGENT: UAT IS DOWN'), [], 'a shouted line');
    const at = findTermSpans('Ask about NDF today')[0];
    assert.deepStrictEqual([at.start, at.end], [10, 13]);
  });

  test('a phrase spells a term when each letter starts a word, small words skipped', () => {
    assert.ok(matchesInitials('NDF', 'non-deliverable forward'));
    assert.ok(matchesInitials('UAT', 'user acceptance testing'));
    assert.ok(matchesInitials('ROI', 'return on investment'));
    assert.ok(matchesInitials('UTI', 'Unique Transaction Identifier'));
    assert.ok(matchesInitials('3DS', '3-D Secure'));
    assert.ok(matchesInitials('BoE'.toUpperCase(), 'Bank of England'));
    assert.ok(!matchesInitials('NDF', 'new forward'));
    assert.ok(!matchesInitials('UAT', 'the test environment'));
  });

  test('reads each way a definition is written inline', () => {
    const read = (text: string) => readInlineDefinitions(text).map(({ term, text: words }) => [term, words]);
    assert.deepStrictEqual(read('We trade the NDF (non-deliverable forward) book.'), [['NDF', 'non-deliverable forward']]);
    assert.deepStrictEqual(read('A non-deliverable forward (NDF) settles in cash.'), [['NDF', 'non-deliverable forward']]);
    assert.deepStrictEqual(read('- **UTI**: the trade id both sides report.'), [['UTI', 'the trade id both sides report']]);
    assert.deepStrictEqual(read('INC: an incident ticket'), [['INC', 'an incident ticket']]);
    assert.deepStrictEqual(read('RATES-UAT means the rates test environment; ask Sam.'), [['RATES-UAT', 'the rates test environment']]);
    assert.deepStrictEqual(read('UAT stands for user acceptance testing'), [['UAT', 'user acceptance testing']]);
    // The initials must fit, a task is no definition line, and code is code.
    assert.deepStrictEqual(read('The NDF (see the deck) is late'), []);
    assert.deepStrictEqual(read('- [ ] UAT: sign off'), []);
    assert.deepStrictEqual(read('`NDF: not this`'), []);
  });

  test('counts the entries that use a term, and keeps one used in three', () => {
    const index = indexOf([
      ['a.md', '2026-03-01', lines('# A', 'UAT starts. UAT again.', '## B', 'UAT in another entry', 'NDF once')],
      ['b.md', '2026-03-02', lines('---', 'env: UAT', '---', '# C', 'UAT here too', '```', 'NDF in code', '```', 'NDF twice')],
      ['c.md', '2026-03-03', lines('UTI', 'UTI', '# Later', 'UTI')],
    ]);
    const { terms } = getTermTable(index);
    assert.deepStrictEqual([...terms.keys()].sort(), ['UAT']);
    assert.strictEqual(terms.get('UAT')?.count, 3);
    assert.deepStrictEqual(terms.get('UAT')?.firstUse, { filePath: 'a.md', date: new Date('2026-03-01T09:00:00').getTime(), line: 2, heading: 'A' });
    assert.strictEqual(getTermTable(index), getTermTable(index), 'built once per index');
  });

  test('takes the first inline definition by date, and a term note wins over it', () => {
    const uses = (filePath: string, day: string): [string, string, string] => [filePath, day, lines('# Notes', 'NDF desk call')];
    const inline = indexOf([
      ['later.md', '2026-03-09', lines('# FX recon', 'NDF: a cash-settled forward')],
      ['kickoff.md', '2026-03-03', lines('# FX recon kickoff', 'Book the NDF (non-deliverable forward) trades.')],
      uses('x.md', '2026-03-04'),
      uses('y.md', '2026-03-05'),
    ]);
    const defined = getTermTable(inline).terms.get('NDF');
    assert.strictEqual(defined?.count, 4);
    assert.deepStrictEqual(defined?.definition, {
      filePath: 'kickoff.md',
      date: new Date('2026-03-03T09:00:00').getTime(),
      line: 2,
      heading: 'FX recon kickoff',
      text: 'non-deliverable forward',
      source: 'inline',
      quote: 'Book the NDF (non-deliverable forward) trades.',
    });

    const withNote = indexOf([
      ...[...inline.files.values()].map((file): [string, string, string] => [file.filePath, '2026-03-03', file.content]),
      ['Terms/NDF.md', '2026-04-01', lines('---', 'type: term', 'term: NDF', '---', '# NDF', '', 'A forward on a currency', 'that cannot be delivered.', '', 'More.')],
    ]);
    const note = getTermTable(withNote).terms.get('NDF')?.definition;
    assert.strictEqual(note?.source, 'note');
    assert.strictEqual(note?.filePath, 'Terms/NDF.md');
    assert.strictEqual(note?.text, 'A forward on a currency that cannot be delivered');
    assert.strictEqual(note?.line, 7);
  });

  test('a term note is read by its title when it has no term field, however few use it', () => {
    const index = indexOf([['Terms/SLO.md', '2026-03-01', lines('---', 'type: term', '---', '# SLO', 'Service level objective: the target.')]]);
    const entry = getTermTable(index).terms.get('SLO');
    assert.strictEqual(entry?.definition?.text, 'Service level objective: the target');
    assert.strictEqual(entry?.count, 1);
    // An inline definition alone makes no term of a token used once.
    assert.strictEqual(getTermTable(indexOf([['a.md', '2026-03-01', 'NDF (non-deliverable forward)']])).terms.size, 0);
  });

  test('reads the term a question asks about', () => {
    assert.strictEqual(readTermQuestion('NDF'), 'NDF');
    assert.strictEqual(readTermQuestion('ndf'), 'NDF');
    assert.strictEqual(readTermQuestion('what is NDF?'), 'NDF');
    assert.strictEqual(readTermQuestion("What's rates-uat"), 'RATES-UAT');
    assert.strictEqual(readTermQuestion('what does UTI mean'), 'UTI');
    assert.strictEqual(readTermQuestion('who leads payments'), undefined);
  });

  test('Find answers a defined term, or what it is, with its definition, which opens where it was defined', () => {
    const index = indexOf([
      ['kickoff.md', '2026-03-03', lines('# FX recon kickoff', 'Book the NDF (non-deliverable forward) trades.')],
      ['x.md', '2026-03-04', 'NDF desk'],
      ['y.md', '2026-03-05', 'NDF call'],
      ['z.md', '2026-03-05', lines('UAT', '# A', 'UAT', '# B', 'UAT')],
    ]);
    const now = new Date('2026-10-14T12:00:00').getTime();
    const expected = {
      kind: 'note',
      answer: 'term',
      label: 'non-deliverable forward',
      description: 'NDF · defined in FX recon kickoff',
      filePath: 'kickoff.md',
      line: 2,
    };
    assert.deepStrictEqual(listAnswerItems(index, 'NDF', now), [expected]);
    assert.deepStrictEqual(listAnswerItems(index, 'what is ndf?', now), [expected]);
    assert.deepStrictEqual(listAnswerItems(index, 'UAT', now), [], 'a term with no definition');
    assert.deepStrictEqual(listAnswerItems(index, 'NDF desk', now), []);
  });

  test('builds the table of 3,000 notes in well under a second', () => {
    const files: ParsedFile[] = [];
    for (let at = 0; at < 3000; at += 1) {
      files.push(
        noteOn(
          `notes/${at}.md`,
          '2026-03-01',
          lines(
            `# Meeting ${at} #project/fx`,
            `- Sam says the UAT run for RATES-UAT ${at} is green; NDF fixings next.`,
            '- [ ] Send the UTI list to ops 📅 2026-03-04',
            '## Notes',
            `Talked about INC-${at % 50} and the OK from the US desk, see [[Runbook]].`,
            'The SLO (service level objective) holds at 99.9.',
            ...Array.from({ length: 20 }, (_, line) => (line % 4 === 0 ? `Line ${line}: the EMEA desk signed off.` : `Line ${line} of plain prose, with a word or two in it.`)),
          ),
        ),
      );
    }
    // The median of three builds, each over the notes as new objects, so
    // none is read from the last build's cache. About 100 ms on a laptop;
    // the bound leaves room for a loaded or slower machine, and still fails
    // a table that reads its notes more than once over.
    const builds = [0, 1, 2].map(() => {
      const fresh = files.map((file) => ({ ...file }));
      const started = performance.now();
      const table = buildTermTable(fresh);
      const took = performance.now() - started;
      assert.ok(table.terms.has('RATES-UAT') && table.terms.get('SLO')?.definition, 'read every note');
      return took;
    });
    const median = [...builds].sort((left, right) => left - right)[1];
    assert.ok(median < 1000, `the median build took ${median.toFixed(0)} ms`);
  });
});
