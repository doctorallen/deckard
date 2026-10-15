import * as assert from 'assert';

import type { WorkspaceIndex } from '../domain/model';
import { getEntityNamespaceAliases } from '../domain/markdown/parser';
import { getTypeIndex } from '../domain/types/typeIndex';
import {
  applyLineInsert,
  describeReading,
  filedDate,
  filedWords,
  findFieldReadings,
  findLineMentions,
  formatFiledLine,
  linkToLine,
  listFilingTargets,
  placeUnderNotes,
  planReadingWrite,
  readingValues,
} from '../ui/state/fileThis';
import { indexOf } from './typedWorkspace';

const lines = (...text: string[]): string => text.join('\n');

/** Teams, people, and areas, whose schema tables say which phrases mean which field. */
function workspace(): WorkspaceIndex {
  return indexOf({
    'Types/Person.md': lines(
      '---', 'deckard-type: person', 'rows: "@*"', '---', '# Person', '',
      '| Field | Kind | Reverse | Words              |',
      '| ----- | ---- | ------- | ------------------ |',
      '| team  | Team | members | moved to, joined   |',
    ),
    'Types/Team.md': lines(
      '---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '',
      '| Field | Kind                 | Reverse  | Words                     |',
      '| ----- | -------------------- | -------- | ------------------------- |',
      '| lead  | Person               | lead of  | leads, now leads, led by  |',
      '| owns  | Area, many           | owned by | owns, took over           |',
      '| tier  | Select: gold, silver |          | is now                    |',
    ),
    'Types/Area.md': lines('---', 'deckard-type: area', 'rows: "#area/*"', '---', '# Area', '', '| Field | Kind |', '| ----- | ---- |', '| system | Text |'),
    'Teams/FX.md': lines('---', 'describes: "#team/fx"', 'lead: "@alex-rivera"', 'owns: ["#area/options"]', '---', '# FX'),
    'Teams/Rates.md': lines('---', 'describes: "#team/rates"', '---', '# Rates'),
    'People/Priya Natarajan.md': lines('---', 'describes: "@priya-natarajan"', '---', '# Priya Natarajan'),
    'People/Alex Rivera.md': lines('---', 'describes: "@alex-rivera"', 'team: "#team/fx"', '---', '# Alex Rivera'),
    'notes/areas.md': lines('# Areas', '- #area/options and #area/swaps', '- @sam-okafor has no note'),
    'journal/2026-10-14.md': lines('# 2026-10-14', '## Org news', '- @priya-natarajan now leads #team/fx'),
  });
}

const aliases = getEntityNamespaceAliases(undefined);

/** What a line offers to set, as the lightbulb words it. */
function offers(index: WorkspaceIndex, line: string): string[] {
  const types = getTypeIndex(index);
  return findFieldReadings(types, line, findLineMentions(index, types, line, { sourcePath: 'journal/2026-10-14.md', aliases })).map(describeReading);
}

suite('File this', () => {
  test('finds the rows a line mentions, in order, with their hub notes, a link to a row’s note among them', () => {
    const index = workspace();
    const types = getTypeIndex(index);
    const line = '- @priya-natarajan told #team/fx about [[Rates]] and #misc';
    const mentions = findLineMentions(index, types, line, { sourcePath: 'journal/2026-10-14.md', aliases });
    assert.deepStrictEqual(mentions.map((mention) => [line.slice(mention.start, mention.end), mention.row?.id, mention.hubPath]), [
      ['@priya-natarajan', '@priya-natarajan', 'People/Priya Natarajan.md'],
      ['#team/fx', '#team/fx', 'Teams/FX.md'],
      ['[[Rates]]', '#team/rates', undefined],
      ['#misc', undefined, undefined],
    ]);
    assert.deepStrictEqual(listFilingTargets(mentions, 'journal/2026-10-14.md'), [
      { hubPath: 'People/Priya Natarajan.md', title: 'Priya Natarajan' },
      { hubPath: 'Teams/FX.md', title: 'FX' },
    ], 'a tag with a hub note, each once; a link is no place to file');
  });

  test('offers at most four hub notes, never the note the line is in', () => {
    const index = indexOf(Object.fromEntries([
      ...['a', 'b', 'c', 'd', 'e'].map((name) => [`hubs/${name}.md`, lines('---', `describes: "#x/${name}"`, '---', `# ${name}`)]),
      ['notes/line.md', '- #x/e #x/a #x/b #x/a #x/c #x/d'],
    ]));
    const types = getTypeIndex(index);
    const line = '- #x/e #x/a #x/b #x/a #x/c #x/d';
    const targets = listFilingTargets(findLineMentions(index, types, line, { sourcePath: 'hubs/e.md', aliases }), 'hubs/e.md');
    assert.deepStrictEqual(targets.map((target) => target.title), ['a', 'b', 'c', 'd']);
  });

  test('reads both ways round: the field on the subject’s type, or on the other row’s', () => {
    const index = workspace();
    assert.deepStrictEqual(offers(index, '- @priya-natarajan now leads #team/fx'), ['Set FX’s lead to Priya Natarajan (was Alex Rivera)']);
    assert.deepStrictEqual(offers(index, '- #team/fx is led by @priya-natarajan'), ['Set FX’s lead to Priya Natarajan (was Alex Rivera)']);
    assert.deepStrictEqual(offers(index, '- @alex-rivera moved to #team/rates'), ['Set Alex Rivera’s team to Rates (was FX)']);
    assert.deepStrictEqual(offers(index, '- @priya-natarajan joined [[Rates]]'), ['Set Priya Natarajan’s team to Rates']);
  });

  test('a value must fit the field: a person for a Person field, a row of its type, an option of a select', () => {
    const index = workspace();
    assert.deepStrictEqual(offers(index, '- #team/fx now leads #team/rates'), [], 'a team is no lead');
    assert.deepStrictEqual(offers(index, '- @priya-natarajan leads the standup'), [], 'nothing after the phrase to set');
    assert.deepStrictEqual(offers(index, '- #team/fx is now Gold'), ['Set FX’s tier to gold']);
    assert.deepStrictEqual(offers(index, '- #team/fx is now platinum'), []);
    assert.deepStrictEqual(offers(index, '- @priya-natarajan misleads #team/fx'), [], 'a phrase is whole words');
  });

  test('a field that holds several adds the value; one already there is not offered', () => {
    const index = workspace();
    const types = getTypeIndex(index);
    const line = '- #team/fx took over #area/swaps';
    const [reading] = findFieldReadings(types, line, findLineMentions(index, types, line, { sourcePath: 'notes/x.md', aliases }));
    assert.strictEqual(describeReading(reading), 'Add Swaps to FX’s owns');
    assert.deepStrictEqual(readingValues(reading), ['#area/options', '#area/swaps']);
    // Written over what the hub holds as it is now, which may be more than the index read.
    assert.deepStrictEqual(planReadingWrite(reading, ['#area/options', '#area/credit']), ['#area/options', '#area/credit', '#area/swaps']);
    assert.strictEqual(planReadingWrite(reading, ['#area/swaps']), 'held');
    const lead = '- @priya-natarajan now leads #team/fx';
    const [setLead] = findFieldReadings(types, lead, findLineMentions(index, types, lead, { sourcePath: 'notes/x.md', aliases }));
    assert.deepStrictEqual(planReadingWrite(setLead, ['@alex-rivera']), ['@priya-natarajan']);
    assert.strictEqual(planReadingWrite(setLead, ['@sam-okafor']), 'stale', 'not what the action said it was');
    assert.deepStrictEqual(offers(index, '- #team/fx owns #area/options'), []);
    assert.deepStrictEqual(offers(index, '- @alex-rivera joined #team/fx'), []);
  });

  test('a select’s option is read only outside tags, code, and links', () => {
    const index = indexOf({
      'Types/Team.md': lines(
        '---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '',
        '| Field | Kind                | Words              |',
        '| ----- | ------------------- | ------------------ |',
        '| stage | Select: new, active | stage is, is now   |',
      ),
      'Teams/FX.md': lines('---', 'describes: "#team/fx"', '---', '# FX'),
      'notes/p.md': lines('- #project/new-checkout'),
    });
    assert.deepStrictEqual(offers(index, '- #team/fx stage is per #project/new-checkout'), []);
    assert.deepStrictEqual(offers(index, '- #team/fx stage is `new` [new](x.md) [[new]]'), []);
    assert.deepStrictEqual(offers(index, '- #team/fx stage is active'), ['Set FX’s stage to active']);
  });

  test('a row with no hub note yet can still be set, its note written then', () => {
    const index = workspace();
    const types = getTypeIndex(index);
    const line = '- @sam-okafor joined #team/rates';
    const [reading] = findFieldReadings(types, line, findLineMentions(index, types, line, { sourcePath: 'notes/x.md', aliases }));
    assert.deepStrictEqual([reading.rowId, reading.filePath, reading.was], ['@sam-okafor', undefined, []]);
    assert.strictEqual(describeReading(reading), 'Set Sam Okafor’s team to Rates');
  });

  test('files the line as written, its list mark and box aside, dated by its daily note, with a link to its heading', () => {
    const index = workspace();
    const note = lines('# 2026-10-14', '## Org news #meeting/all-hands', '- [ ] @priya-natarajan now leads #team/fx');
    const link = linkToLine(note.split('\n'), 2, { sourcePath: 'journal/2026-10-14.md', fromPath: 'Teams/FX.md', style: 'wiki' });
    const words = filedWords('- [ ] @priya-natarajan now leads #team/fx');
    const date = filedDate(index.files.get('journal/2026-10-14.md'), Date.now());
    assert.strictEqual(formatFiledLine(words, date, link), '- 2026-10-14: @priya-natarajan now leads #team/fx ([[2026-10-14#Org news]])');
    assert.strictEqual(linkToLine(['A line'], 0, { sourcePath: 'notes/Loose.md', fromPath: 'Teams/FX.md', style: 'wiki' }), '[[Loose]]', 'no heading: the note');
    assert.strictEqual(linkToLine(['# Loose', 'A line'], 1, { sourcePath: 'notes/Loose.md', fromPath: 'Teams/FX.md', style: 'wiki' }), '[[Loose]]', 'its heading is its title');
    assert.strictEqual(linkToLine(note.split('\n'), 2, { sourcePath: 'journal/2026-10-14.md', fromPath: 'Teams/FX.md', style: 'markdown' }), '[2026-10-14#Org news](../journal/2026-10-14.md)');
    assert.strictEqual(filedDate(index.files.get('notes/areas.md'), new Date(2026, 9, 20, 9).getTime()), '2026-10-20', 'any other note: today');
  });

  test('puts the line last in the Notes list, at any level, or makes ## Notes at the end', () => {
    const entry = '- 2026-10-14: a fact ([[2026-10-14]])';
    const listed = lines('---', 'describes: "#team/fx"', '---', '# FX', '', '### Notes', '- older', '  - its detail', '', 'Loose words.', '## Next');
    assert.strictEqual(applyLineInsert(listed, placeUnderNotes(listed, entry)), lines(
      '---', 'describes: "#team/fx"', '---', '# FX', '', '### Notes', '- older', '  - its detail', entry, '', 'Loose words.', '## Next',
    ));
    const prose = lines('# FX', '## Notes', 'Some words.');
    assert.strictEqual(applyLineInsert(prose, placeUnderNotes(prose, entry)), lines('# FX', '## Notes', 'Some words.', '', entry));
    const missing = '# FX\nThe team.\n';
    assert.strictEqual(applyLineInsert(missing, placeUnderNotes(missing, entry)), '# FX\nThe team.\n\n## Notes\n\n- 2026-10-14: a fact ([[2026-10-14]])\n');
    const crlf = '# FX\r\n## Notes\r\n';
    assert.strictEqual(applyLineInsert(crlf, placeUnderNotes(crlf, entry)), `# FX\r\n## Notes\r\n${entry}\r\n`);
  });
});
