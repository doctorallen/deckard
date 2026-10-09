import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import { answerQuestion, findRowsByPhrase, type TypeAnswer } from '../domain/types/typeAnswers';
import { getTypeIndex } from '../domain/types/typeIndex';
import { answerDescribeTag, describeWorkspaceTypes } from '../ui/state/assistantDescribe';
import { answerQuery, answerTags } from '../ui/state/assistantTools';
import { buildQuickFindResults, findChoiceKey, type QuickFindResults } from '../ui/state/quickFindState';
import type { WorkspaceIndex } from '../domain/model';
import { createPreferences, MemoryStore } from './preferenceServices';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const lines = (...text: string[]): string => text.join('\n');

/**
 * The typed workspace with words to ask by: teams also called by other
 * names, a channel, a person's role, Priya on Rates, and an FX team beside
 * the FX area.
 */
function askingWorkspace(): WorkspaceIndex {
  const base = typedWorkspace();
  const notes = Object.fromEntries(
    [...base.files.values(), ...(base.typeNotes?.values() ?? [])].map((file) => [file.filePath, file.content]),
  );
  return indexOf({
    ...notes,
    'Types/Person.md': lines(
      '---',
      'deckard-type: person',
      'rows: "@*"',
      '---',
      '# Person',
      '',
      '| Field | Kind  | Reverse |',
      '| ----- | ----- | ------- |',
      '| team  | Team  | members |',
      '| role  | Text  |         |',
      '| email | Email |         |',
    ),
    'Types/Team.md': lines(
      '---',
      'deckard-type: team',
      'rows: "#team/*"',
      '---',
      '# Team',
      '',
      '| Field   | Kind       | Reverse  | Also called           |',
      '| ------- | ---------- | -------- | --------------------- |',
      '| lead    | Person     | lead of  | head, manager, run by |',
      '| owns    | Area, many | owned by | responsible for       |',
      '| on-call | Person     |          | oncall, pager         |',
      '| channel | Text       |          | slack                 |',
    ),
    'Teams/Rates.md': lines(
      '---',
      'describes: "#team/rates"',
      'lead: "@dana"',
      'owns: [bond trading, "#area/fx", "#area/swaps", "#area/repo"]',
      'on-call: Priya Natarajan',
      'channel: "#rates-desk"',
      '---',
      '# Rates',
      '- [ ] Hire a quant 📅 2020-01-01',
    ),
    'Teams/FX.md': lines('---', 'describes: "#team/fx"', 'lead: omar', '---', '# FX'),
    'People/Dana Whitfield.md': lines('---', 'describes: "@dana"', 'team: rates', 'role: Head of Rates', 'email: dana@example.com', '---', '# Dana Whitfield'),
    'People/Priya Natarajan.md': lines('---', 'describes: "@priya"', 'team: rates', '---', '# Priya Natarajan'),
    'notes/areas.md': lines('# Areas #area/bond-trading', 'Who owns what.', '', '# FX #area/fx', '', '# Swaps #area/swaps', '', '# Repo #area/repo'),
  });
}

const index = askingWorkspace();
const types = getTypeIndex(index);

/** What each answer is, and the path to it, as Find shows them. */
function describe(answers: readonly TypeAnswer[]): Array<[string, string]> {
  return answers.map((answer) => [
    answer.value.rowId ? (types.row(answer.value.rowId)?.title ?? answer.value.text) : answer.value.text,
    [answer.from.title, ...answer.hops.map((hop) => `${hop.field} ${types.row(hop.rowId)?.title}`), answer.field.name].join(' › '),
  ]);
}

const ask = (question: string): Array<[string, string]> => describe(answerQuestion(types, question, now));

suite('Types: answers to questions', () => {
  test("reads a row and its own field, in any case, with a possessive or a trailing s", () => {
    assert.deepStrictEqual(ask('rates lead'), [['Dana Whitfield', 'Rates › lead']]);
    assert.deepStrictEqual(ask("RATES' LEAD"), [['Dana Whitfield', 'Rates › lead']]);
    assert.deepStrictEqual(ask("who leads rates?"), [['Dana Whitfield', 'Rates › lead']]);
    assert.deepStrictEqual(ask('rate leads'), [['Dana Whitfield', 'Rates › lead']], 'a trailing s either way');
    assert.deepStrictEqual(ask("Rates's head"), [['Dana Whitfield', 'Rates › lead']], 'a word the field is also called');
    assert.deepStrictEqual(ask('#team/rates lead'), [['Dana Whitfield', 'Rates › lead']], 'the tag as written');
  });

  test('walks a relation\'s reverse to the nearest row with the field', () => {
    assert.deepStrictEqual(ask('who leads bond trading'), [['Dana Whitfield', 'Bond Trading › owned by Rates › lead']]);
    assert.deepStrictEqual(ask('bond-trading lead'), [['Dana Whitfield', 'Bond Trading › owned by Rates › lead']], 'hyphens part words');
    assert.deepStrictEqual(ask('who is responsible for bond trading'), [['Rates', 'Bond Trading › owned by']], 'the forward field\'s other name asks for its reverse');
    assert.deepStrictEqual(
      ask('who leads the team responsible for bond trading'),
      [['Dana Whitfield', 'Bond Trading › owned by Rates › lead']],
      'a type and a relation on the way may be named',
    );
  });

  test('walks two hops, and no further', () => {
    // Dana › team Rates › owns: one hop. Bond trading › owned by Rates › members › team: Rates again, so visited.
    assert.deepStrictEqual(ask('dana team channel'), [['#rates-desk', 'Dana Whitfield › team Rates › channel']]);
    assert.deepStrictEqual(ask('bond trading channel'), [['#rates-desk', 'Bond Trading › owned by Rates › channel']]);
    assert.deepStrictEqual(ask('bond trading email'), [['dana@example.com', 'Bond Trading › owned by Rates › lead Dana Whitfield › email']]);
  });

  test('answers who is on a row, its members, and what a person owns', () => {
    const members = [
      ['Dana Whitfield', 'Rates › members'],
      ['Priya Natarajan', 'Rates › members'],
    ];
    assert.deepStrictEqual(ask('who is on rates'), members);
    assert.deepStrictEqual(ask("who's on the rates team"), members);
    assert.deepStrictEqual(ask('rates members'), members);
    assert.deepStrictEqual(ask('what does priya own'), [
      ['Bond Trading', 'Priya Natarajan › team Rates › owns'],
      ['Fx', 'Priya Natarajan › team Rates › owns'],
      ['Swaps', 'Priya Natarajan › team Rates › owns'],
    ], 'three at most');
    assert.deepStrictEqual(ask('rates channel'), [['#rates-desk', 'Rates › channel']]);
    assert.deepStrictEqual(ask('rates slack'), [['#rates-desk', 'Rates › channel']]);
    assert.deepStrictEqual(ask('rates oncall'), [['Priya Natarajan', 'Rates › on-call']]);
  });

  test('a people reverse with no name of its own still answers who is on a row', () => {
    const plain = indexOf({
      'Types/Person.md': lines('---', 'deckard-type: person', 'rows: "@*"', '---', '# Person', '', '| Field | Kind |', '| ----- | ---- |', '| squad | Squad |'),
      'Types/Squad.md': lines('---', 'deckard-type: squad', 'rows: "#squad/*"', '---', '# Squad', '', '| Field | Kind |', '| ----- | ---- |', '| goal | Text |'),
      'People/Ana.md': lines('---', 'describes: "@ana"', 'squad: blue', '---', '# Ana'),
      'notes/squads.md': lines('# Blue #squad/blue'),
    });
    const plainTypes = getTypeIndex(plain);
    const titles = (question: string): string[] =>
      answerQuestion(plainTypes, question, now).map((answer) => plainTypes.row(answer.value.rowId ?? '')?.title ?? answer.value.text);
    assert.deepStrictEqual(titles('who is on blue'), ['Ana']);
    assert.deepStrictEqual(titles('blue people'), ['Ana']);
    assert.deepStrictEqual(titles('blue squad of'), [], 'a row and its type alone ask for nothing');
  });

  test('ranks fewer hops first, then the row named best', () => {
    // The FX team's own lead, then the FX area's owner's lead.
    assert.deepStrictEqual(ask('fx lead'), [
      ['Omar Haddad', 'FX › lead'],
      ['Dana Whitfield', 'Fx › owned by Rates › lead'],
    ]);
  });

  test('answers nothing for a row alone, words no path explains, a query, or a workspace with no types', () => {
    assert.deepStrictEqual(ask('rates'), []);
    assert.deepStrictEqual(ask('rates lead banana'), []);
    assert.deepStrictEqual(ask('standup notes'), []);
    assert.deepStrictEqual(ask('lead = @dana'), []);
    assert.deepStrictEqual(ask('is:open rates lead'), []);
    const untyped = getTypeIndex(indexOf({ 'notes/a.md': '# Rates #team/rates\nlead: dana' }));
    assert.deepStrictEqual(answerQuestion(untyped, 'rates lead', now), []);
    assert.deepStrictEqual(findRowsByPhrase(untyped, 'rates'), []);
  });

  test('finds rows by a phrase: a whole title first, then the longest run', () => {
    assert.deepStrictEqual(findRowsByPhrase(types, 'Dana Whitfield').map((match) => match.row.id), ['@dana']);
    assert.deepStrictEqual(findRowsByPhrase(types, 'bond trading').map((match) => match.row.id), ['#area/bond-trading']);
    assert.deepStrictEqual(
      findRowsByPhrase(types, 'fx').map((match) => match.row.id).sort(),
      ['#area/fx', '#team/fx'],
      'every row the name fits',
    );
  });
});

/** Find's results for what is typed, over an index, with no text index behind it. */
function find(over: WorkspaceIndex, input: string): QuickFindResults {
  return buildQuickFindResults({
    index: over,
    preferences: createPreferences(new MemoryStore()).reader.value,
    input,
    searchText: () => ({ matches: [], partial: false }),
    queryContext: createQueryContext(now),
  });
}

suite('Types: Find answers', () => {
  test('lists answers first, each opening its value\'s page, with its type and path', () => {
    const results = find(index, 'who leads bond trading');
    assert.deepStrictEqual(results.answers, [
      {
        kind: 'tag',
        answer: 'person',
        label: 'Dana Whitfield',
        description: '@dana · Person · Head of Rates',
        detail: 'Bond Trading › owned by Rates › lead',
        tagKey: '@dana',
      },
    ]);
    assert.strictEqual(findChoiceKey(index, results.answers?.[0] ?? { kind: 'tag', label: '' }), undefined, 'an answer is not learned');

    const [channel] = find(index, 'rates channel').answers ?? [];
    assert.deepStrictEqual(channel, {
      kind: 'tag',
      answer: 'value',
      tagKey: '#team/rates',
      label: '#rates-desk',
      description: 'channel of Rates',
      detail: 'Rates › channel',
    }, 'a text value opens the row that holds it');

    const [area] = find(index, 'what does fx team own').answers ?? [];
    assert.strictEqual(area, undefined, 'the FX team owns nothing');
    const owned = find(index, 'what does rates own').answers ?? [];
    assert.deepStrictEqual(owned.map((item) => [item.answer, item.label, item.tagKey]), [
      ['tag', 'Bond Trading', '#area/bond-trading'],
      ['tag', 'Fx', '#area/fx'],
      ['tag', 'Swaps', '#area/swaps'],
    ]);
  });

  test('a note row answers as a note, opened at its first line', () => {
    const [incident] = find(index, 'dana owner of').answers ?? [];
    assert.deepStrictEqual(incident && [incident.kind, incident.answer, incident.label, incident.filePath, incident.line, incident.description], [
      'note',
      'note',
      'RFQ outage',
      'Incidents/RFQ outage.md',
      1,
      'Incidents/RFQ outage.md · Incident',
    ]);
  });

  test('lists no answers for a search, and nothing new in a workspace with no types', () => {
    assert.strictEqual(find(index, 'standup').answers, undefined);
    const untyped = indexOf({ 'notes/a.md': '# Rates #team/rates\n- [ ] Call Dana', 'notes/b.md': '# Lead #team/rates' });
    const results = find(untyped, 'rates lead');
    assert.ok(!('answers' in results));
    assert.deepStrictEqual(find(untyped, 'rates').tags.map((tag) => tag.description), ['2 notes · 1 task']);
  });

  test('a typed tag under Tags leads with its type and one fact', () => {
    const tags = find(index, 'rates').tags;
    const rates = tags.find((tag) => tag.tagKey === '#team/rates');
    assert.match(rates?.description ?? '', /^Team · lead Dana Whitfield · \d+ notes? · \d+ tasks?$/);
    const dana = find(index, '@dan').tags.find((tag) => tag.tagKey === '@dana');
    assert.match(dana?.description ?? '', /^Person · team Rates · /);
    const area = find(index, 'swaps').tags.find((tag) => tag.tagKey === '#area/swaps');
    assert.match(area?.description ?? '', /^Area · \d+ notes? · /, 'a row with no fact is its type');
  });
});

suite('Types: the assistant', () => {
  test('describes a typed row: its type, note, fields, reverses, tasks, and latest entries', () => {
    const text = answerDescribeTag(index, { tag: '#team/rates' }, now);
    const expected = [
      'Team: Rates (#team/rates), Teams/Rates.md',
      'lead: Dana Whitfield (@dana)',
      'owns: Bond Trading (#area/bond-trading), Fx (#area/fx), Swaps (#area/swaps), Repo (#area/repo)',
      'on-call: Priya Natarajan (@priya)',
      'channel: #rates-desk',
      'members (reverse of Person.team): Dana Whitfield (@dana), Priya Natarajan (@priya)',
    ];
    assert.deepStrictEqual(text.split('\n').slice(0, expected.length), expected);
    assert.match(text, /^Open tasks: 2, 1 overdue$/m);
    assert.match(text, /^Latest entries:\n- 2026-10-08 Standup — notes\/standup\.md:1/m);
    assert.ok(!text.includes('Teams/Rates.md:'), 'its hub note is not one of its entries');
  });

  test('resolves a title or a phrase as Find does, and names the other rows it fits', () => {
    assert.match(answerDescribeTag(index, { tag: 'Dana Whitfield' }, now), /^Person: Dana Whitfield \(@dana\), People\/Dana Whitfield\.md\nteam: Rates \(#team\/rates\)\nrole: Head of Rates\nemail: dana@example\.com\nlead of \(reverse of Team\.lead\): Rates \(#team\/rates\)/);
    const fx = answerDescribeTag(index, { tag: 'fx' }, now);
    assert.match(fx, /^(Area: Fx \(#area\/fx\)\. No hub note\.|Team: FX \(#team\/fx\), Teams\/FX\.md)/);
    assert.match(fx, /"fx" also matches: /);
    assert.match(answerDescribeTag(index, { tag: '#area/swaps' }, now), /^Area: Swaps \(#area\/swaps\)\. No hub note\.\nowned by \(reverse of Team\.owns\): Rates \(#team\/rates\)/);
    assert.match(answerDescribeTag(index, { tag: 'RFQ outage' }, now), /^Incident: RFQ outage \(type: incident\), Incidents\/RFQ outage\.md\nowner: Dana Whitfield \(@dana\)/);
  });

  test('describes a tag no type has, and says when nothing matches', () => {
    const plain = indexOf({
      'notes/atlas.md': lines('---', 'describes: "#project/atlas"', '---', '# Atlas'),
      'notes/log.md': lines('# Kickoff #project/atlas', '- [ ] Send the plan 📅 2020-01-01', '- [ ] Book the room'),
    });
    const text = answerDescribeTag(plain, { tag: 'atlas' }, now);
    assert.deepStrictEqual(text.split('\n'), [
      'Tag: #project/atlas (2 notes · 2 tasks)',
      'Hub note: notes/atlas.md',
      'Open tasks: 2, 1 overdue',
      'Latest entries:',
      '- 2026-10-08 Kickoff — notes/log.md:1',
    ]);
    assert.strictEqual(answerDescribeTag(plain, { tag: 'nothing here' }, now), 'No tag or row matches "nothing here". Call deckard_list_tags to see the tags that exist.');
  });

  test('the query and tag-list answers name the types and their fields, and say nothing of them without types', () => {
    const line = describeWorkspaceTypes(index) ?? '';
    assert.match(line, /^Types in this workspace: Area \(system; reverses: owned by\), Incident \(owner, team, severity\), Person \(team, role, email; reverses: lead of, on-call of, owner of\), Team \(lead, owns, on-call, channel; reverses: members, team of\)\./);
    const context = createQueryContext(now);
    assert.strictEqual(answerQuery(index, { query: 'type = team' }, context).split('\n')[1], line);
    assert.strictEqual(answerTags(index, {}).split('\n')[1], line);
    const plain = indexOf({ 'notes/a.md': '# A #project/atlas' });
    assert.strictEqual(describeWorkspaceTypes(plain), undefined);
    assert.ok(!answerQuery(plain, { query: 'tag = #project/atlas' }, context).includes('Types in this workspace'));
    assert.ok(!answerTags(plain, {}).includes('Types in this workspace'));
  });
});
