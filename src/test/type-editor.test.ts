import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { getTypeIndex } from '../domain/types/typeIndex';
import {
  describeFieldGuess,
  describeRowSource,
  guessFieldKind,
  guessNotesFolder,
  guessTypeFields,
  listRowSources,
} from '../domain/types/createType';
import { planRowNote, pluralTypeName, rowNotesFolder } from '../domain/types/rowNotes';
import { allowKindTarget, findTableCellAt, findTableCells, writeTypeNote } from '../domain/types/typeNoteWriter';
import { describeHubLenses, describeNoteProblems } from '../ui/state/editorLensState';
import {
  findFrontmatterCompletionContext,
  findKindCellContext,
  listFieldKeyCompletions,
  listFieldValueCompletions,
  listKindCompletions,
  listRowsCompletions,
} from '../ui/state/typeCompletions';
import { describeRowHover } from '../ui/state/typeHover';
import { countTypeProblems, describeTypeDiagnostics, locateTypeProblem } from '../ui/state/typeProblems';
import { describeNoteRows, findClosestRows, findRowTypes, listKindRows } from '../ui/state/typeRows';
import { indexOf, now, typedWorkspace } from './typedWorkspace';

const lines = (...text: string[]): string[] => text;
const index = typedWorkspace();
const types = getTypeIndex(index);

/** The workspace with notes whose values name nothing, and a team that owns systems. */
function untidyWorkspace(): ReturnType<typeof indexOf> {
  const base = Object.fromEntries(
    [...index.files.values(), ...(index.typeNotes?.values() ?? [])].map((file) => [file.filePath, file.content]),
  );
  return indexOf({
    ...base,
    'Teams/FX.md': lines('---', 'describes: "#team/fx"', 'lead: "Omar H"', 'tier: gld', 'owns: ["#system/oms", "#system/ems"]', '---', '# FX').join('\n'),
    'notes/systems.md': lines('# OMS #system/oms', '# EMS #system/ems').join('\n'),
  });
}

suite('Types in the editor: completions', () => {
  const rates = lines('---', 'describes: "#team/rates"', 'lead: "@dana"', '', 'tier: ', 'owns: [bond trading, "#ar', '---', '# Rates');

  test('reads where the cursor is in front matter: a key, a value, or one of a list', () => {
    const key = findFrontmatterCompletionContext(rates, 3, 0);
    assert.strictEqual(key?.kind, 'key');
    assert.ok(key?.kind === 'key' && key.present.has('lead') && key.present.has('describes'));
    assert.deepStrictEqual(findFrontmatterCompletionContext(rates, 4, 6), { kind: 'value', key: 'tier', start: 6, end: 6, typed: '', quoted: false });
    const listed = findFrontmatterCompletionContext(rates, 5, rates[5].length);
    assert.deepStrictEqual(listed, { kind: 'value', key: 'owns', start: 21, end: 25, typed: '#ar', quoted: true });
    assert.strictEqual(findFrontmatterCompletionContext(rates, 7, 2), undefined, 'below the front matter');
    assert.strictEqual(findFrontmatterCompletionContext(['# Title', 'lead: x'], 1, 7), undefined, 'a note with no front matter');
  });

  test('offers the type\'s fields the note does not write yet, each written as its key', () => {
    const file = parseMarkdown('Teams/Rates.md', rates.join('\n'), { createdAt: now, updatedAt: now });
    const rowTypes = findRowTypes(types.registry, file);
    assert.deepStrictEqual(rowTypes.map((type) => type.key), ['team']);
    const context = findFrontmatterCompletionContext(rates, 3, 0);
    assert.ok(context?.kind === 'key');
    const offered = listFieldKeyCompletions(rowTypes, context.present);
    assert.deepStrictEqual(offered.map((item) => item.label), ['headcount', 'on-call', 'status'], 'lead, owns, and tier are written');
    assert.strictEqual(offered[0].insertText, 'headcount: ');
    assert.strictEqual(offered[0].detail, 'Team field · Number');
  });

  test('offers the rows a relation names, each with its type and first relation, written as Deckard writes it', () => {
    const team = [types.registry.get('team')].flatMap((type) => (type ? [type] : []));
    const people = listFieldValueCompletions(types, index, team, { key: 'lead', typed: '' });
    const dana = people.find((item) => item.label === 'Dana Whitfield');
    assert.ok(dana);
    assert.strictEqual(dana.insertText, '"@dana"');
    assert.strictEqual(dana.detail, 'Person · team Rates');
    assert.match(dana.documentation, /Writes "@dana"/);
    assert.deepStrictEqual(
      listFieldValueCompletions(types, index, team, { key: 'lead', typed: 'om' }).map((item) => item.label),
      ['Omar Haddad'],
    );
    const person = [types.registry.get('person')].flatMap((type) => (type ? [type] : []));
    const teams = listFieldValueCompletions(types, index, person, { key: 'team', typed: 'cre' });
    assert.deepStrictEqual(teams.map((item) => [item.label, item.insertText, item.detail]), [['Credit', '"#team/credit"', 'Team · lead Omar Haddad']]);
    assert.deepStrictEqual(
      listFieldValueCompletions(types, index, team, { key: 'tier', typed: '', quoted: true }).map((item) => [item.insertText, item.filterText]),
      [['gold', '"gold'], ['silver', '"silver'], ['bronze', '"bronze']],
    );
    assert.deepStrictEqual(listFieldValueCompletions(types, index, person, { key: 'remote', typed: '' }).map((item) => item.label), ['true', 'false']);
    const incident = [types.registry.get('incident')].flatMap((type) => (type ? [type] : []));
    assert.ok(
      listFieldValueCompletions(types, index, incident, { key: 'team', typed: '' }).some((item) => item.insertText === '"#team/rates"'),
    );
  });

  test('in a type note, offers kinds and type names in the Kind column, and rows for rows:', () => {
    const text = lines('---', 'deckard-type: desk', 'rows: ', '---', '# Desk', '', '| Field | Kind |', '| ----- | ---- |', '| head  | Pe   |');
    const file = parseMarkdown('Types/Desk.md', text.join('\n'), { createdAt: now, updatedAt: now }, { typeNote: true });
    assert.deepStrictEqual(findKindCellContext(file.typeNote, text, 8, 12), { start: 10, end: 12 });
    assert.strictEqual(findKindCellContext(file.typeNote, text, 8, 4), undefined, 'the Field column');
    assert.strictEqual(findKindCellContext(file.typeNote, text, 6, 12), undefined, 'the header');
    const kinds = listKindCompletions(types.registry.types).map((item) => item.label);
    assert.deepStrictEqual(kinds.slice(0, 5), ['Text', 'Number', 'Date', 'Checkbox', 'Select']);
    assert.ok(kinds.includes('Team') && kinds.includes('Incident'));
    assert.strictEqual(listKindCompletions([]).find((item) => item.label === 'Select')?.insertText, 'Select: ');
    const rows = listRowsCompletions(index).map((item) => item.insertText);
    assert.ok(rows.includes('"#team/*"') && rows.includes('"#area/*"'));
    assert.deepStrictEqual(rows.slice(-2), ['"@*"', 'notes']);
    assert.ok(!rows.includes('"#person/*"'), 'people are "@*"');
  });
});

suite('Types in the editor: marks and quick fixes', () => {
  const untidy = untidyWorkspace();
  const untidyTypes = getTypeIndex(untidy);
  const fx = untidy.files.get('Teams/FX.md')?.content.split('\n') ?? [];

  test('marks a value that names nothing, with the closest rows and a new row to change it to', () => {
    const marks = describeTypeDiagnostics(untidyTypes, untidy, 'Teams/FX.md', fx);
    const lead = marks.find((mark) => mark.line === 2);
    assert.ok(lead);
    assert.strictEqual(lead.message, 'No person is named "Omar H" yet.');
    assert.deepStrictEqual([lead.start, lead.end], [6, 14], 'the value, quotes and all');
    assert.deepStrictEqual(
      lead.fixes.map((fix) => fix.title),
      ['Change to @omar (Omar Haddad)', 'Create person "Omar H"'],
    );
    const change = lead.fixes[0];
    assert.ok(change.kind === 'replace' && change.text === '"@omar"' && change.preferred);
    assert.deepStrictEqual(lead.fixes[1], { kind: 'create-row', title: 'Create person "Omar H"', typeKey: 'person', rowTitle: 'Omar H' });
    const tier = marks.find((mark) => mark.line === 3);
    assert.deepStrictEqual(tier?.fixes.map((fix) => fix.title), ['Change to gold']);
    const owns = marks.filter((mark) => mark.line === 4);
    assert.strictEqual(owns.length, 2);
    assert.ok(owns.every((mark) => !mark.fixes.some((fix) => fix.kind === 'create-row')), 'a #system/ tag is no area to create');
  });

  test('on the type\'s table, offers to allow the other namespace or make a type of it', () => {
    const team = untidy.typeNotes?.get('Types/Team.md')?.content.split('\n') ?? [];
    const marks = describeTypeDiagnostics(untidyTypes, untidy, 'Types/Team.md', team);
    const owns = marks.find((mark) => mark.code === 'other-namespace');
    assert.ok(owns);
    assert.strictEqual(owns.message, '2 values of owns are #system/ tags, which Area does not take.');
    assert.deepStrictEqual(owns.fixes.map((fix) => fix.title), ['Allow Area or System', 'Create a System type']);
    const allow = owns.fixes[0];
    assert.ok(allow.kind === 'replace');
    assert.strictEqual(allow.text, 'Area or System, many');
    assert.strictEqual(team[allow.line].slice(allow.start, allow.end), 'Area, many');
    assert.deepStrictEqual(owns.fixes[1], { kind: 'create-type', title: 'Create a System type', key: 'system', name: 'System', rows: '#system/*' });
    const builtIn = marks.find((mark) => mark.code === 'built-in-name');
    assert.ok(builtIn, 'status is a built-in query field');
    assert.strictEqual(team[builtIn.line].slice(builtIn.start, builtIn.end), 'status');
  });

  test('a kind naming no type offers to create it', () => {
    const desk = lines('---', 'deckard-type: desk', 'rows: notes', '---', '# Desk', '', '| Field | Kind   |', '| ----- | ------ |', '| venue | Venue  |').join('\n');
    const withDesk = indexOf({ 'Types/Desk.md': desk, 'notes/venues.md': '# Lit #venue/lit' });
    const marks = describeTypeDiagnostics(getTypeIndex(withDesk), withDesk, 'Types/Desk.md', desk.split('\n'));
    const venue = marks.find((mark) => mark.code === 'unknown-kind');
    assert.ok(venue);
    assert.deepStrictEqual([venue.line, desk.split('\n')[venue.line].slice(venue.start, venue.end)], [8, 'Venue']);
    assert.deepStrictEqual(venue.fixes, [{ kind: 'create-type', title: 'Create a Venue type', key: 'venue', name: 'Venue', rows: '#venue/*' }]);
  });

  test('places a problem on its line as written, and drops one whose value is gone', () => {
    const problem = { code: 'unresolved-value' as const, field: 'lead', value: 'Omar H' };
    assert.deepStrictEqual(locateTypeProblem("lead: 'Omar H'", problem), { start: 6, end: 14 });
    assert.deepStrictEqual(locateTypeProblem('lead: [dana, Omar H]', problem), { start: 13, end: 19 });
    assert.strictEqual(locateTypeProblem('lead: "@omar"', problem), undefined);
    assert.deepStrictEqual(locateTypeProblem('  status: x', { code: 'field-kinds-differ', field: 'status' }), { start: 2, end: 8 });
  });

  test('counts values that name nothing apart from the rest, in the one problems lens', () => {
    assert.deepStrictEqual(countTypeProblems([{ code: 'unresolved-value' }, { code: 'kind-mismatch' }, { code: 'relation-conflict' }]), {
      unresolved: 2,
      other: 1,
    });
    const counts = { missing: 1, ambiguous: 0, creatable: 1, mentions: 0, mentionNotes: 0 };
    const fieldsOnly = describeNoteProblems({ ...counts, missing: 0, creatable: 0, unresolved: 2 });
    assert.strictEqual(fieldsOnly?.title, '2 unresolved');
    assert.strictEqual(fieldsOnly?.action, 'showFieldProblems');
    const both = describeNoteProblems({ ...counts, unresolved: 1, fieldProblems: 1 });
    assert.strictEqual(both?.title, '1 missing · 1 unresolved · 1 field problem');
    assert.strictEqual(both?.action, 'pick');
    assert.deepStrictEqual(both?.fixes, ['showBrokenLinks', 'createMissingNotes', 'showFieldProblems']);
    assert.strictEqual(describeNoteProblems(counts)?.title, '1 missing', 'untyped notes count as before');
  });

  test('ranks the rows closest to a loose value', () => {
    const people = listKindRows(types, index, { name: 'person', many: false });
    assert.deepStrictEqual(findClosestRows(people, 'Omar H').map((choice) => choice.id), ['@omar']);
    assert.deepStrictEqual(findClosestRows(people, 'dnaa').map((choice) => choice.id), ['@dana'], 'a typo');
    assert.deepStrictEqual(findClosestRows(people, 'zzz'), []);
  });
});

suite('Types in the editor: the lens and the hover', () => {
  test('leads the hub lens with the row\'s type and first relation, and gives a row with no tasks that lead alone', () => {
    const rows = describeNoteRows(types, 'Teams/Rates.md');
    assert.deepStrictEqual(rows.map((row) => row.prefix), ['Team · Dana Whitfield']);
    const progress = [{ tagKey: '#team/rates', tagLabel: '#team/rates', text: '0/2 done (0%)' }];
    assert.deepStrictEqual(describeHubLenses(progress, rows).map((lens) => lens.title), ['Team · Dana Whitfield | 0/2 done (0%)']);
    const dana = describeNoteRows(types, 'People/Dana Whitfield.md');
    assert.deepStrictEqual(describeHubLenses([], dana), [{ title: 'Person · Rates', tagKey: '@dana', tagLabel: '@dana' }]);
    const incident = describeNoteRows(types, 'Incidents/RFQ outage.md');
    assert.deepStrictEqual(describeHubLenses([], incident), [
      { title: 'Incident · Dana Whitfield', typeKey: 'incident', typeName: 'Incident' },
    ]);
    assert.deepStrictEqual(describeHubLenses(progress, []).map((lens) => lens.title), ['Progress: 0/2 done (0%)'], 'untyped hubs as before');
    assert.deepStrictEqual(describeNoteRows(types, 'notes/plain.md'), []);
  });

  test('a person\'s hover names them, their relations, how to reach them, and when they were last mentioned', () => {
    const hover = describeRowHover(types, '@dana', { now, counts: { noteCount: 14, taskCount: 5, openTaskCount: 3 } });
    assert.ok(hover);
    assert.strictEqual(hover.heading, '**Dana Whitfield** `@dana` · Person');
    assert.match(hover.facts[0], /^Team Rates · lead of Rates/);
    assert.match(hover.facts[0], /owner of RFQ outage/);
    assert.strictEqual(hover.facts[1], 'Email [dana@example\\.com](mailto:dana@example.com)');
    assert.strictEqual(hover.activity, '14 notes · 5 tasks, 3 open · 1 overdue · last mentioned today · 2026-10-08');
    assert.deepStrictEqual(hover.tag, { key: '@dana', label: '@dana' });
    assert.strictEqual(hover.filePath, 'People/Dana Whitfield.md');
    assert.strictEqual(hover.email, 'dana@example.com');
  });

  test('a team\'s hover leads with its first Text field, and a note row\'s counts its links and tasks', () => {
    const rates = describeRowHover(types, '#team/rates', { now });
    assert.strictEqual(rates?.heading, '**Rates** `#team/rates` · Team · active');
    assert.match(rates?.facts[0] ?? '', /^Lead Dana Whitfield · owns Bond Trading, Fx/);
    assert.match(rates?.activity ?? '', /1 overdue/);
    const outage = describeRowHover(types, 'file:Incidents/RFQ outage.md', { now });
    assert.strictEqual(outage?.heading, '**RFQ outage** · Incident');
    assert.strictEqual(outage?.tag, undefined);
    assert.strictEqual(describeRowHover(types, '#area/nowhere', { now }), undefined);
  });
});

suite('Create Type from Tags', () => {
  const workspace = indexOf({
    'Desks/Rates desk.md': lines(
      '---',
      'describes: "#desk/rates"',
      'head: "@dana"',
      'opened: 2024-01-02',
      'seats: 12',
      'region: EMEA',
      'site: https://rates.example.com',
      'contact: rates@example.com',
      'status: open',
      'systems: ["#system/oms", "#system/ems", "#app/blotter"]',
      '---',
      '# Rates desk',
    ).join('\n'),
    'Desks/Credit desk.md': lines(
      '---',
      'describes: "#desk/credit"',
      'head: "@omar"',
      'opened: 2023-05-06',
      'seats: 8',
      'region: EMEA',
      'notes: Credit sits on floor 3',
      'systems: ["#system/oms"]',
      '---',
      '# Credit desk',
    ).join('\n'),
    'notes/a.md': '# A #desk/fx @dana @omar #desk/credit/emea',
    'Incidents/One.md': lines('---', 'type: incident', 'owner: "@dana"', '---', '# One').join('\n'),
    'Incidents/Two.md': lines('---', 'type: incident', '---', '# Two').join('\n'),
  });
  const registry = getTypeIndex(workspace).registry;

  test('lists namespaces, the people, and the type: values in use, with their counts', () => {
    const sources = listRowSources(workspace, registry);
    assert.deepStrictEqual(
      sources.map((source) => describeRowSource(source)),
      [
        { label: '#desk', description: '4 tags · 2 hub notes' },
        { label: '#system', description: '2 tags · 0 hub notes' },
        { label: '#app', description: '1 tag · 0 hub notes' },
        { label: '@ people', description: '2 people · 0 hub notes' },
        { label: 'type: incident', description: '2 notes' },
      ],
    );
    assert.deepStrictEqual(sources[0].rows, '#desk/*');
    assert.ok(!listRowSources(index, getTypeIndex(index).registry).some((source) => source.key === 'team'), 'a namespace with a type is left out');
  });

  test('guesses each field\'s kind from its values', () => {
    const source = listRowSources(workspace, registry)[0];
    const files = source.filePaths.flatMap((path) => workspace.files.get(path) ?? []);
    const guesses = guessTypeFields(files, { typeKey: 'desk', registry });
    const kinds = Object.fromEntries(guesses.map((guess) => [guess.name, guess.kind]));
    assert.deepStrictEqual(kinds, {
      head: 'Person',
      opened: 'Date',
      seats: 'Number',
      region: 'Select: EMEA',
      'desk-status': 'Text',
      systems: 'System, many',
      site: 'Link',
      contact: 'Email',
      notes: 'Text',
    });
    const head = guesses.find((guess) => guess.name === 'head');
    assert.deepStrictEqual(head && describeFieldGuess(head), { description: 'Person · 2 of 2 · reverse: head of' });
    const status = guesses.find((guess) => guess.key === 'status');
    assert.match(status ? (describeFieldGuess(status).detail ?? '') : '', /status is a built-in query field, so this is desk-status/);
    const systems = guesses.find((guess) => guess.name === 'systems');
    assert.strictEqual(systems && describeFieldGuess(systems).detail, '1 value is a #app/ tag.');
    assert.strictEqual(guessNotesFolder(source.filePaths), 'Desks/');
    assert.strictEqual(guessNotesFolder(['A/x.md', 'B/y.md']), undefined);
    assert.strictEqual(guessFieldKind([[{ text: 'a' }], [{ text: 'b' }]], registry).kind, 'Text', 'two values used once each read as text');
    assert.strictEqual(guessFieldKind([[{ text: '[[One]]' }]], registry).kind, 'Note');
  });

  test('writes a type note the parser reads back', () => {
    const text = writeTypeNote({
      key: 'desk',
      name: 'Desk',
      rows: '#desk/*',
      notesFolder: 'Desks/',
      fields: [
        { name: 'head', kind: 'Person', reverse: 'head of' },
        { name: 'region', kind: 'Select: EMEA, APAC' },
      ],
    });
    assert.match(text, /^---\ndeckard-type: desk\nrows: "#desk\/\*"\nnotes: Desks\/\n---\n# Desk\n\n\| Field  \| Kind/);
    const note = parseMarkdown('Types/Desk.md', text, { createdAt: now, updatedAt: now }, { typeNote: true }).typeNote;
    assert.ok(note);
    assert.deepStrictEqual(note.problems, []);
    assert.deepStrictEqual(note.rows, { kind: 'tags', prefix: '#desk/', written: '#desk/*' });
    assert.deepStrictEqual(note.fields.map((field) => [field.name, field.kindText, field.reverse]), [
      ['head', 'Person', 'head of'],
      ['region', 'Select: EMEA, APAC', undefined],
    ]);
    const empty = parseMarkdown('Types/Decision.md', writeTypeNote({ key: 'decision', name: 'Decision', rows: 'notes', fields: [] }), { createdAt: now, updatedAt: now }, { typeNote: true }).typeNote;
    assert.deepStrictEqual(empty?.rows, { kind: 'notes', written: 'notes' });
    assert.deepStrictEqual(empty?.problems, [], 'an empty table is still a table');
  });

  test('reads and rewrites a table row\'s cells', () => {
    const row = '| owns  | Area, many \\| x | owned by |';
    assert.deepStrictEqual(findTableCells(row).map((cell) => cell.text), ['owns', 'Area, many \\| x', 'owned by']);
    const kind = findTableCells(row)[1];
    assert.strictEqual(row.slice(kind.start, kind.end), 'Area, many \\| x');
    assert.strictEqual(findTableCellAt(row, 3), 0);
    assert.strictEqual(findTableCellAt(row, 12), 1);
    assert.strictEqual(findTableCellAt('a | b', 4), 1, 'a row without outer pipes');
    assert.strictEqual(allowKindTarget('Area, many', 'System'), 'Area or System, many');
    assert.strictEqual(allowKindTarget('Area', 'System'), 'Area or System');
  });
});

suite('Row notes', () => {
  test('pluralize a type\'s name for its folder', () => {
    assert.deepStrictEqual(['Team', 'Person', 'Policy', 'Process', 'Key', 'Sales desk'].map(pluralTypeName), [
      'Teams',
      'People',
      'Policies',
      'Processes',
      'Keys',
      'Sales desks',
    ]);
    assert.strictEqual(rowNotesFolder({ name: 'Team', notesFolder: '/Org/Teams/' }), 'Org/Teams');
    assert.strictEqual(rowNotesFolder({ name: 'Team' }), 'Teams');
    assert.strictEqual(rowNotesFolder({ name: 'Team', notesFolder: '../out' }), 'Teams', 'never outside the notes folder');
  });

  test('a namespace row is a hub note for its tag, a note row a note with type:, each with the schema\'s keys', () => {
    const team = types.registry.get('team');
    assert.ok(team);
    const plan = planRowNote(team, 'Credit Trading', { now: new Date(now) });
    assert.deepStrictEqual(plan, {
      folder: 'Teams',
      fileName: 'Credit Trading.md',
      tag: '#team/credit-trading',
      content: '---\ndescribes: "#team/credit-trading"\nlead:\nowns:\ntier:\nheadcount:\non-call:\nstatus:\n---\n# Credit Trading\n\n',
    });
    const person = types.registry.get('person');
    assert.ok(person);
    assert.strictEqual(planRowNote(person, 'Omar H', { now: new Date(now) })?.tag, '@omar-h');
    const incident = types.registry.get('incident');
    assert.ok(incident);
    assert.match(planRowNote(incident, 'Feed outage', { now: new Date(now) })?.content ?? '', /^---\ntype: incident\nowner:\nteam:\nseverity:\n---/);
    assert.strictEqual(planRowNote(incident, 'a/b', { now: new Date(now) }), undefined, 'not a file name');
    // The parser reads the new note back as a row of its type.
    const content = plan?.content ?? '';
    const read = getTypeIndex(indexOf({ ...Object.fromEntries([...(index.typeNotes ?? new Map())].map(([path, file]) => [path, file.content])), 'Teams/Credit Trading.md': content }));
    assert.strictEqual(read.rowOfTag('#team/credit-trading')?.title, 'Credit Trading');
  });

  test('a type\'s template is filled, and the row\'s identity added unless it writes one', () => {
    const team = types.registry.get('team');
    assert.ok(team);
    const template = '---\ntier: silver\n---\n# {title}\n\nTag: {tag}\n';
    assert.strictEqual(
      planRowNote(team, 'Credit', { template, now: new Date(now) })?.content,
      '---\ndescribes: "#team/credit"\ntier: silver\n---\n# Credit\n\nTag: #team/credit\n',
    );
    const own = '---\ndescribes: "{tag}"\n---\n# {title}\n';
    assert.strictEqual(planRowNote(team, 'Credit', { template: own, now: new Date(now) })?.content, '---\ndescribes: "#team/credit"\n---\n# Credit\n');
  });
});
