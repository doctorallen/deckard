import * as assert from 'assert';

import { buildWorkspaceIndex, IndexState } from '../domain/index/indexState';
import { parseMarkdown, PARSE_FORMAT } from '../domain/markdown/parser';
import { addDays, startOfDay } from '../domain/markdown/calendar';
import type { ParsedFile, TypeNote, WorkspaceIndex } from '../domain/model';
import { parseFieldKind, reverseNameOf, toFieldQueryName } from '../domain/types/fieldKinds';
import { readCheckboxValue, readDateValue, readNumberValue, readSelectValue } from '../domain/types/fieldValues';
import { getTypeIndex, MAX_PATH_SEGMENTS, TypeIndex } from '../domain/types/typeIndex';
import { buildTypeRegistry } from '../domain/types/typeRegistry';
import { readRowsRule, splitTableRow } from '../domain/types/typeNotes';
import { createSearchEntries } from '../core/storage/searchDatabase';
import { decodeParsedFile, encodeParsedFile } from '../core/storage/parsedFileCodec';
import { WorkspaceScanner } from '../core/workspace/scanner';
import { createWorkspaceIndex } from '../core/workspace/indexer';
import { createFakeAccess, fileUri, joinUri } from './fakeWorkspace';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

/** A note parsed as the scanner parses it: a type note when it is in `Types/`. */
function parse(filePath: string, content: string, updatedAt = now): ParsedFile {
  return parseMarkdown(filePath, content, { createdAt: updatedAt, updatedAt }, { typeNote: filePath.startsWith('Types/') });
}

/** The index of these notes, each `[content, days ago]` or just content, updated now. */
function indexOf(notes: Record<string, string | [string, number]>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, note]) => {
        const [content, daysAgo] = typeof note === 'string' ? [note, 0] : note;
        return [filePath, parse(filePath, content, now - daysAgo * DAY)];
      }),
    ),
  );
}

/** A type note's definition, read on its own. */
function typeNoteOf(content: string, filePath = 'Types/Team.md'): TypeNote {
  const typeNote = parse(filePath, content).typeNote;
  assert.ok(typeNote, 'a note in Types/ is read as a type');
  return typeNote;
}

const PERSON_TYPE = [
  '---',
  'deckard-type: person',
  'rows: "@*"',
  '---',
  '# Person',
  '',
  '| Field  | Kind     | Reverse | Also called |',
  '| ------ | -------- | ------- | ----------- |',
  '| team   | Team     | members |             |',
  '| email  | Email    |         | mail        |',
  '| start  | Date     |         |             |',
  '| remote | Checkbox |         |             |',
].join('\n');

const TEAM_TYPE = [
  '---',
  'deckard-type: team',
  'rows: "#team/*"',
  'notes: Teams/',
  '---',
  '# Team',
  '',
  'Free text above the table.',
  '',
  '| Field     | Kind                         | Reverse     | Also called           | Owner note |',
  '| --------- | ---------------------------- | ----------- | --------------------- | ---------- |',
  '| lead      | Person                       | lead of     | head, manager, run by | keep me    |',
  '| owns      | Area, many                   | owned by    | responsible for       |            |',
  '| tier      | Select: gold, silver, bronze |             |                       |            |',
  '| members   | Person, many                 | team        |                       |            |',
  '| headcount | Number                       |             |                       |            |',
  '| on-call   | Person                       |             | oncall, pager         |            |',
  '',
  'Free text below the table describes the type.',
].join('\n');

const AREA_TYPE = [
  '---',
  'deckard-type: area',
  'rows: "#area/*"',
  '---',
  '# Area',
  '',
  '| Field  | Kind |',
  '| ------ | ---- |',
  '| system | Text |',
].join('\n');

const INCIDENT_TYPE = [
  '---',
  'deckard-type: incident',
  'rows: notes',
  '---',
  '# Incident',
  '',
  '| Field    | Kind             |',
  '| -------- | ---------------- |',
  '| owner    | Person           |',
  '| team     | Team             |',
  '| follows  | Incident         |',
  '| severity | Select: sev1, sev2 |',
].join('\n');

/** A small work knowledge base: people, teams, areas, and incidents. */
function workspace(): WorkspaceIndex {
  return indexOf({
    'Types/Person.md': PERSON_TYPE,
    'Types/Team.md': TEAM_TYPE,
    'Types/Area.md': AREA_TYPE,
    'Types/Incident.md': INCIDENT_TYPE,
    'Teams/Rates.md': [
      '---',
      'describes: "#team/rates"',
      'lead: "@dana"',
      'owns: [bond trading, "#area/fx"]',
      'tier: Gold',
      'members: ["@dana", "@omar"]',
      'headcount: "1,200"',
      'on-call: Priya Natarajan',
      '---',
      '# Rates',
      '- [x] Hire a quant',
    ].join('\n'),
    'Teams/Credit.md': ['---', 'describes: "#team/credit"', 'lead: Omar H', 'tier: platinum', '---', '# Credit'].join('\n'),
    'People/Dana Whitfield.md': [
      '---',
      'describes: "@dana"',
      'aliases: [DW]',
      'team: rates',
      'email: dana@example.com',
      'start: 2026-03-01',
      'remote: yes',
      '---',
      '# Dana Whitfield',
    ].join('\n'),
    'People/Omar Haddad.md': ['---', 'describes: "#person/omar"', 'team: "#team/credit"', 'start: soon', '---', '# Omar'].join('\n'),
    'People/Priya Natarajan.md': ['---', 'describes: "@priya"', '---', '# Priya'].join('\n'),
    'notes/areas.md': '# Areas #area/bond-trading\nWho owns what.',
    'notes/standup.md': [
      ['# Standup #team/rates/emea', '- [ ] Fix pricing #team/rates 📅 2020-01-01', '- [ ] Plan #team/fx/options'].join('\n'),
      2,
    ],
    'notes/old.md': ['# Old offsite #team/rates', 60],
    'Incidents/RFQ outage.md': ['---', 'type: incident', 'owner: dana', 'team: Rates', 'severity: SEV1', '---', '# RFQ outage'].join('\n'),
    'Incidents/Feed lag.md': ['---', 'type: Incident', 'follows: "[[RFQ outage]]"', 'severity: sev3', '---', '# Feed lag'].join('\n'),
    'notes/review.md': [['# Review', 'See [[RFQ outage]].'].join('\n'), 5],
    'notes/plain.md': ['---', 'type: memo', 'status: draft', '---', '# Plain'].join('\n'),
  });
}

suite('Types: the schema table', () => {
  test('reads the key, display name, rows, notes folder, and every field of a type note', () => {
    const type = typeNoteOf(TEAM_TYPE);
    assert.strictEqual(type.key, 'team');
    assert.strictEqual(type.name, 'Team');
    assert.deepStrictEqual(type.rows, { kind: 'tags', prefix: '#team/', written: '#team/*' });
    assert.strictEqual(type.notesFolder, 'Teams/');
    assert.deepStrictEqual(type.columns, ['Field', 'Kind', 'Reverse', 'Also called', 'Owner note']);
    assert.deepStrictEqual(type.table, { startLine: 10, endLine: 17 });
    assert.deepStrictEqual(type.keyLine, 2);
    assert.deepStrictEqual(type.rowsLine, 3);
    assert.deepStrictEqual(type.fields[0], {
      name: 'lead',
      key: 'lead',
      kindText: 'Person',
      kind: { name: 'person', many: false },
      reverse: 'lead of',
      alsoCalled: ['head', 'manager', 'run by'],
      line: 12,
      extra: { 'Owner note': 'keep me' },
    });
    assert.deepStrictEqual(
      type.fields.map((field) => [field.name, field.kind.name, field.kind.many]),
      [
        ['lead', 'person', false],
        ['owns', 'relation', true],
        ['tier', 'select', false],
        ['members', 'person', true],
        ['headcount', 'number', false],
        ['on-call', 'person', false],
      ],
    );
    assert.deepStrictEqual(type.problems, []);
  });

  test('a type note has no entries, tasks, tags, or links of its own', () => {
    const file = parse('Types/Team.md', `${TEAM_TYPE}\n- [ ] Not a task #team/rates [[Rates]]`);
    assert.deepStrictEqual([file.sections, file.tasks, file.frontmatterTags, file.links], [[], [], [], []]);
    assert.strictEqual(file.hub, undefined);
  });

  test('takes the first table with Field and Kind columns, outside code, case and spacing aside', () => {
    const type = typeNoteOf(
      [
        '---',
        'deckard-type: project',
        'rows: "#project/*"',
        '---',
        '| Name | Value |',
        '| ---- | ----- |',
        '| a    | b     |',
        '',
        '```',
        '| Field | Kind |',
        '| ----- | ---- |',
        '| fenced | Text |',
        '```',
        '',
        '|FIELD|kind|ALSO CALLED|',
        '|:--|:-:|---|',
        '| `owner` | `person` | lead |',
        '| pipe | Text \\| more | |',
        '',
        '| Field | Kind |',
        '| ----- | ---- |',
        '| second | Text |',
      ].join('\n'),
      'Types/Project.md',
    );
    assert.strictEqual(type.name, 'Project', 'no heading: the key title-cased');
    assert.deepStrictEqual(
      type.fields.map((field) => [field.name, field.kindText, field.alsoCalled]),
      [
        ['owner', 'person', ['lead']],
        ['pipe', 'Text | more', []],
      ],
    );
    assert.deepStrictEqual(splitTableRow('| a \\| b | c |'), ['a | b', 'c']);
  });

  test('says what a type note gets wrong, by line', () => {
    const type = typeNoteOf(
      [
        '---',
        'rows: "#team things"',
        '---',
        '# Squad',
        '| Field | Kind |',
        '| ----- | ---- |',
        '| on call | Person |',
        '| lead | |',
        '| lead | Text |',
        '| | Text |',
      ].join('\n'),
      'Types/Squad Room.md',
    );
    assert.strictEqual(type.key, 'squad-room', 'a missing key is read from the file name');
    assert.strictEqual(type.rows, undefined);
    assert.deepStrictEqual(
      type.problems.map((problem) => [problem.code, problem.line]),
      [
        ['no-key', 1],
        ['bad-rows', 2],
        ['bad-field-name', 7],
        ['missing-kind', 8],
        ['duplicate-field', 9],
        ['missing-field', 10],
      ],
    );
    assert.deepStrictEqual(type.fields.map((field) => [field.name, field.kind.name]), [['lead', 'text']]);
    assert.deepStrictEqual(
      typeNoteOf('---\ndeckard-type: x\nrows: notes\n---\n# X').problems.map((problem) => problem.code),
      ['no-table'],
    );
  });

  test('reads rows: namespaces, people, and notes', () => {
    assert.deepStrictEqual(readRowsRule('#team/*'), { kind: 'tags', prefix: '#team/', written: '#team/*' });
    assert.deepStrictEqual(readRowsRule('team'), { kind: 'tags', prefix: '#team/', written: 'team' });
    assert.deepStrictEqual(readRowsRule('#org/acme/**'), { kind: 'tags', prefix: '#org/acme/', written: '#org/acme/**' });
    assert.deepStrictEqual(readRowsRule('@*'), { kind: 'tags', prefix: '@', written: '@*' });
    assert.deepStrictEqual(readRowsRule('#person/*'), { kind: 'tags', prefix: '@', written: '#person/*' });
    assert.deepStrictEqual(readRowsRule('Notes'), { kind: 'notes', written: 'Notes' });
    assert.strictEqual(readRowsRule('two words'), undefined);
    const aliased = parseMarkdown('Types/Project.md', '---\ndeckard-type: project\nrows: "#proj/*"\n---', undefined, {
      typeNote: true,
      entityNamespaceAliases: { proj: 'project' },
    });
    assert.deepStrictEqual(aliased.typeNote?.rows, { kind: 'tags', prefix: '#project/', written: '#proj/*' }, 'an alias is resolved');
  });
});

suite('Types: kinds', () => {
  test('reads each kind, any case, with an optional ", many"', () => {
    assert.deepStrictEqual(parseFieldKind('Text').kind, { name: 'text', many: false });
    assert.deepStrictEqual(parseFieldKind('NUMBER').kind, { name: 'number', many: false });
    assert.deepStrictEqual(parseFieldKind('date').kind, { name: 'date', many: false });
    assert.deepStrictEqual(parseFieldKind('Checkbox').kind, { name: 'checkbox', many: false });
    assert.deepStrictEqual(parseFieldKind('Person, many').kind, { name: 'person', many: true });
    assert.deepStrictEqual(parseFieldKind('Note').kind, { name: 'note', many: false });
    assert.deepStrictEqual(parseFieldKind('Link').kind, { name: 'link', many: false });
    assert.deepStrictEqual(parseFieldKind('Email').kind, { name: 'email', many: false });
    assert.deepStrictEqual(parseFieldKind('Phone').kind, { name: 'phone', many: false });
    assert.deepStrictEqual(parseFieldKind('Select: gold, silver, bronze').kind, {
      name: 'select',
      many: false,
      options: ['gold', 'silver', 'bronze'],
    });
    assert.deepStrictEqual(parseFieldKind('select: a, b, many').kind, { name: 'select', many: true, options: ['a', 'b'] });
    assert.deepStrictEqual(parseFieldKind('Area or System, Many').kind, {
      name: 'relation',
      many: true,
      targets: ['Area', 'System'],
    });
    assert.deepStrictEqual(parseFieldKind(''), { kind: { name: 'text', many: false }, missing: true });
  });

  test('resolves relations by display name or key, people too, and reads one naming no type as Text', () => {
    const registry = buildTypeRegistry([
      parse('Types/Person.md', PERSON_TYPE),
      parse('Types/Team.md', TEAM_TYPE),
      parse('Types/Area.md', AREA_TYPE),
      parse(
        'Types/System.md',
        [
          '---',
          'deckard-type: system',
          'rows: "#system/*"',
          '---',
          '| Field | Kind | Reverse |',
          '| --- | --- | --- |',
          '| part of | Text | |',
          '| area | AREA or team | |',
          '| steward | Person or Team | stewards |',
          '| home | Aera | |',
          '| status | Text | |',
          '| size | Number | size of |',
        ].join('\n'),
      ),
    ]);
    const system = registry.get('System');
    assert.ok(system);
    assert.strictEqual(registry.get('system'), system, 'by key or display name, any case');
    assert.deepStrictEqual(system.fields.map((field) => [field.name, field.kind]), [
      ['area', { name: 'relation', many: false, targets: ['area', 'team'] }],
      ['steward', { name: 'relation', many: false, targets: ['person', 'team'], people: true }],
      ['home', { name: 'text', many: false }],
      ['status', { name: 'text', many: false }],
      ['size', { name: 'number', many: false }],
    ]);
    assert.deepStrictEqual(
      registry.problems.filter((problem) => problem.filePath === 'Types/System.md').map((problem) => [problem.code, problem.line]),
      [
        ['bad-field-name', 7],
        ['unknown-kind', 10],
        ['built-in-name', 11],
        ['reverse-on-non-relation', 12],
      ],
    );
    assert.strictEqual(
      registry.problems.find((problem) => problem.code === 'unknown-kind')?.message,
      '"Aera" is not a kind or a type, so home is read as Text.',
    );
  });

  test('a key or rows written twice is a problem, and the first by path keeps it', () => {
    const registry = buildTypeRegistry([
      parse('Types/Team.md', TEAM_TYPE),
      parse('Types/Zteam.md', TEAM_TYPE),
      parse('Types/Squad.md', TEAM_TYPE.replace('deckard-type: team', 'deckard-type: squad')),
    ]);
    assert.deepStrictEqual(registry.types.map((type) => [type.key, type.filePath]), [
      ['squad', 'Types/Squad.md'],
      ['team', 'Types/Team.md'],
    ]);
    assert.deepStrictEqual(
      registry.problems.filter((problem) => problem.code.startsWith('duplicate')).map((problem) => [problem.code, problem.filePath]),
      [
        ['duplicate-rows', 'Types/Team.md'],
        ['duplicate-type', 'Types/Zteam.md'],
      ],
    );
  });

  test('names a reverse for queries', () => {
    assert.strictEqual(reverseNameOf({ name: 'lead', reverse: undefined }), 'lead of');
    assert.strictEqual(reverseNameOf({ name: 'owns', reverse: 'owned by' }), 'owned by');
    assert.strictEqual(toFieldQueryName('Owned  By'), 'owned-by');
  });

  test('reads loose numbers, dates, checkboxes, and options', () => {
    assert.strictEqual(readNumberValue('1,200'), 1200);
    assert.strictEqual(readNumberValue('1.5'), 1.5);
    assert.strictEqual(readNumberValue('-3'), -3);
    assert.strictEqual(readNumberValue('12 people'), undefined);
    assert.strictEqual(readDateValue('2026-03-01', now), '2026-03-01');
    assert.strictEqual(readDateValue('2026-03-01T09:30:00Z', now), '2026-03-01');
    assert.strictEqual(readDateValue('2026-02-30', now), undefined);
    const tomorrow = new Date(addDays(startOfDay(now), 1));
    assert.strictEqual(
      readDateValue('tomorrow', now),
      `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`,
    );
    assert.strictEqual(readDateValue('soon', now), undefined);
    assert.deepStrictEqual(['yes', 'On', 'TRUE', 'no', 'off', 'false', 'maybe'].map(readCheckboxValue), [
      true,
      true,
      true,
      false,
      false,
      false,
      undefined,
    ]);
    assert.strictEqual(readSelectValue({ options: ['Gold', 'silver'] }, 'GOLD'), 'Gold');
    assert.strictEqual(readSelectValue({ options: ['Gold'] }, 'platinum'), undefined);
    assert.strictEqual(readSelectValue({ options: [] }, 'anything'), 'anything');
  });
});

suite('Types: rows', () => {
  const index = workspace();
  const types = getTypeIndex(index);

  test('a namespace type has a row for every tag under it, with or without a hub note', () => {
    assert.deepStrictEqual(
      types.rows('team').map((row) => [row.id, row.title, row.filePath, row.implicit ?? false]),
      [
        ['#team/rates', 'Rates', 'Teams/Rates.md', false],
        ['#team/credit', 'Credit', 'Teams/Credit.md', false],
        ['#team/rates/emea', 'Emea', undefined, false],
        ['#team/fx/options', 'Options', undefined, false],
        ['#team/fx', 'Fx', undefined, true],
      ],
    );
    assert.deepStrictEqual(types.rows('Area').map((row) => row.id).sort(), ['#area/bond-trading', '#area/fx']);
  });

  test('a nested tag has its parent, and a level with no tag of its own is a row too', () => {
    assert.strictEqual(types.row('#team/rates/emea')?.parentId, '#team/rates');
    assert.deepStrictEqual(types.computed('#team/rates', now).children, ['#team/rates/emea']);
    assert.deepStrictEqual(types.computed('#team/fx', now).children, ['#team/fx/options']);
    assert.deepStrictEqual(types.field('#team/rates/emea', 'parent', now)?.values, [{ text: 'Rates', rowId: '#team/rates' }]);
    assert.deepStrictEqual(types.field('#team/rates', 'children', now)?.values.map((value) => value.rowId), ['#team/rates/emea']);
  });

  test('@dana and #person/dana are one row', () => {
    const omar = types.rowOfTag('#person/omar');
    assert.ok(omar);
    assert.strictEqual(omar.id, '@omar');
    assert.deepStrictEqual([...omar.tagKeys].sort(), ['#person/omar', '@omar']);
    assert.strictEqual(omar.title, 'Omar Haddad');
    assert.strictEqual(omar.filePath, 'People/Omar Haddad.md');
    assert.strictEqual(types.rowOfTag('@omar'), omar);
    assert.deepStrictEqual(types.row('@dana')?.aliases, ['DW']);
  });

  test('a note whose type: names a note type is a row; one naming no type, or a namespace type, is not', () => {
    assert.deepStrictEqual(
      types.rows('incident').map((row) => [row.id, row.title, row.filePath]),
      [
        ['file:Incidents/RFQ outage.md', 'RFQ outage', 'Incidents/RFQ outage.md'],
        ['file:Incidents/Feed lag.md', 'Feed lag', 'Incidents/Feed lag.md'],
      ],
    );
    assert.deepStrictEqual(types.rowsOfFile('notes/plain.md'), []);
    assert.strictEqual(index.files.get('notes/plain.md')?.typeKey, 'memo');
    const teamTyped = getTypeIndex(indexOf({ 'Types/Team.md': TEAM_TYPE, 'x.md': '---\ntype: team\n---\n# X' }));
    assert.deepStrictEqual(teamTyped.rowsOfFile('x.md'), []);
  });

  test('finds rows by title, alias, tag, or slug', () => {
    assert.deepStrictEqual(types.findRows('Dana Whitfield').map((row) => row.id), ['@dana']);
    assert.deepStrictEqual(types.findRows('dw').map((row) => row.id), ['@dana']);
    assert.deepStrictEqual(types.findRows('#team/rates').map((row) => row.id), ['#team/rates']);
    assert.deepStrictEqual(types.findRows('bond trading').map((row) => row.id), ['#area/bond-trading']);
    assert.deepStrictEqual(types.findRows('rfq outage').map((row) => row.id), ['file:Incidents/RFQ outage.md']);
  });

  test('a workspace with no types has no rows and builds nothing', () => {
    const empty = getTypeIndex(indexOf({ 'a.md': '# A #team/rates' }));
    assert.strictEqual(empty.isEmpty, true);
    assert.deepStrictEqual([empty.rows(), empty.problems], [[], []]);
  });
});

suite('Types: values', () => {
  const index = workspace();
  const types = getTypeIndex(index);
  const values = (rowId: string, field: string) =>
    types.field(rowId, field, now)?.values.map((value) => value.rowId ?? value.notePath ?? value.number ?? value.date ?? value.checked ?? value.option ?? value.text);

  test('resolves people and relations from a tag, a slug, a title, or an alias, with or without the namespace', () => {
    assert.deepStrictEqual(values('#team/rates', 'lead'), ['@dana'], 'a tag');
    assert.deepStrictEqual(values('#team/rates', 'owns'), ['#area/bond-trading', '#area/fx'], 'a title, and a tag');
    assert.deepStrictEqual(values('#team/rates', 'on-call'), ['@priya'], 'a hub note’s title');
    assert.deepStrictEqual(values('@dana', 'team'), ['#team/rates'], 'a slug, no namespace');
    assert.deepStrictEqual(values('file:Incidents/RFQ outage.md', 'owner'), ['@dana']);
    assert.deepStrictEqual(values('file:Incidents/RFQ outage.md', 'team'), ['#team/rates'], 'a title');
    const team = types.registry.get('team');
    assert.ok(team);
    const owns = team.fields.find((field) => field.key === 'owns');
    assert.ok(owns);
    assert.strictEqual(types.resolveValue(owns.kind, 'area/fx').rowId, '#area/fx', 'with the namespace');
    assert.strictEqual(types.resolveValue(owns.kind, '#area/bond-trading').rowId, '#area/bond-trading');
    assert.strictEqual(types.resolveValue({ name: 'person', many: false }, 'DW').rowId, '@dana', 'an alias');
    assert.strictEqual(types.resolveValue({ name: 'person', many: false }, 'person/omar').rowId, '@omar');
  });

  test('resolves a note row from a [[link]] or a bare title', () => {
    assert.deepStrictEqual(values('file:Incidents/Feed lag.md', 'follows'), ['file:Incidents/RFQ outage.md']);
    const incident = types.registry.get('incident');
    const follows = incident?.fields.find((field) => field.key === 'follows');
    assert.ok(follows);
    assert.deepStrictEqual(types.resolveValue(follows.kind, 'RFQ outage'), {
      text: 'RFQ outage',
      rowId: 'file:Incidents/RFQ outage.md',
      notePath: 'Incidents/RFQ outage.md',
    });
    assert.deepStrictEqual(types.resolveValue({ name: 'note', many: false }, '[[Rates]]').notePath, 'Teams/Rates.md');
  });

  test('reads numbers, dates, checkboxes, and selects by kind', () => {
    assert.deepStrictEqual(values('#team/rates', 'headcount'), [1200]);
    assert.deepStrictEqual(values('#team/rates', 'tier'), ['gold']);
    assert.deepStrictEqual(values('@dana', 'start'), ['2026-03-01']);
    assert.deepStrictEqual(values('@dana', 'remote'), [true]);
    assert.deepStrictEqual(values('@dana', 'email'), ['dana@example.com']);
    assert.deepStrictEqual(values('file:Incidents/RFQ outage.md', 'severity'), ['sev1']);
  });

  test('keeps a value that resolves to nothing as text, and lists it as a problem with its file and line', () => {
    const lead = types.field('#team/credit', 'lead', now)?.values[0];
    assert.deepStrictEqual(lead, { text: 'Omar H', filePath: 'Teams/Credit.md', line: 3, unresolved: true });
    const problems = types.problems.filter((problem) => problem.code === 'unresolved-value' || problem.code === 'kind-mismatch');
    assert.deepStrictEqual(
      problems.map((problem) => [problem.filePath, problem.line, problem.code, problem.message]),
      [
        ['Incidents/Feed lag.md', 4, 'unresolved-value', '"sev3" is not an option of severity: sev1 or sev2.'],
        ['People/Omar Haddad.md', 4, 'kind-mismatch', 'start is a Date field, and "soon" is not a date.'],
        ['Teams/Credit.md', 3, 'unresolved-value', 'No person is named "Omar H" yet.'],
        ['Teams/Credit.md', 4, 'unresolved-value', '"platinum" is not an option of tier: gold, silver, or bronze.'],
      ],
    );
    assert.deepStrictEqual(types.problemsIn('Teams/Credit.md').map((problem) => problem.line), [3, 4]);
  });

  test('splits a loose list for a field that holds several', () => {
    const loose = getTypeIndex(
      indexOf({
        'Types/Team.md': TEAM_TYPE,
        'Types/Area.md': AREA_TYPE,
        'a.md': '# A #area/fx #area/rates-desk',
        'Teams/Rates.md': '---\ndescribes: "#team/rates"\nowns: fx, rates desk\n---',
      }),
    );
    assert.deepStrictEqual(loose.field('#team/rates', 'owns')?.values.map((value) => value.rowId), ['#area/fx', '#area/rates-desk']);
  });

  test('two types reading one note: the first by key reads a field they define differently, with a problem', () => {
    const both = getTypeIndex(
      indexOf({
        'Types/Team.md': TEAM_TYPE,
        'Types/Squad.md': '---\ndeckard-type: squad\nrows: notes\n---\n| Field | Kind |\n| - | - |\n| headcount | Text |',
        'Teams/Rates.md': '---\ndescribes: "#team/rates"\ntype: squad\nheadcount: about ten\n---',
      }),
    );
    assert.deepStrictEqual(both.rowsOfFile('Teams/Rates.md').map((row) => row.id), ['#team/rates', 'file:Teams/Rates.md']);
    assert.deepStrictEqual(both.field('file:Teams/Rates.md', 'headcount')?.values, [
      { text: 'about ten', filePath: 'Teams/Rates.md', line: 4 },
    ]);
    assert.deepStrictEqual(
      both.problemsIn('Teams/Rates.md').map((problem) => [problem.code, problem.line]),
      [['field-kinds-differ', 4]],
    );
  });
});

suite('Types: reverses, merges, and paths', () => {
  const index = workspace();
  const types = getTypeIndex(index);

  test('computes each relation’s reverse on the rows it names, under the schema’s name', () => {
    const leadOf = types.field('@dana', 'lead of');
    assert.ok(leadOf);
    assert.strictEqual(leadOf.source, 'reverse');
    assert.strictEqual(leadOf.queryName, 'lead-of');
    assert.deepStrictEqual(leadOf.values, [
      { text: 'Rates', rowId: '#team/rates', filePath: 'Teams/Rates.md', line: 3, via: { rowId: '#team/rates', field: 'lead' } },
    ]);
    assert.deepStrictEqual(types.field('#area/bond-trading', 'owned-by')?.values.map((value) => value.rowId), ['#team/rates']);
    assert.deepStrictEqual(
      types.field('file:Incidents/RFQ outage.md', 'follows of')?.values.map((value) => value.rowId),
      ['file:Incidents/Feed lag.md'],
      'the default reverse is "<field> of"',
    );
    assert.deepStrictEqual(
      types.field('@dana', 'owner of')?.values.map((value) => value.rowId),
      ['file:Incidents/RFQ outage.md'],
    );
  });

  test('merges a field written on both sides', () => {
    const members = types.field('#team/rates', 'members');
    assert.strictEqual(members?.source, 'merged');
    assert.deepStrictEqual(members?.values.map((value) => value.rowId), ['@dana', '@omar']);
    const credit = types.field('#team/credit', 'members');
    assert.deepStrictEqual(credit?.values.map((value) => [value.rowId, value.via?.field]), [['@omar', 'team']]);
    assert.deepStrictEqual(types.field('@dana', 'team')?.values.map((value) => value.rowId), ['#team/rates']);
  });

  test('a field that holds one value and is given two is a problem', () => {
    assert.deepStrictEqual(types.field('@omar', 'team')?.values.map((value) => value.rowId), ['#team/credit', '#team/rates']);
    const conflicts = types.problems.filter((problem) => problem.code === 'relation-conflict');
    assert.deepStrictEqual(
      conflicts.map((problem) => [problem.filePath, problem.line, problem.field, problem.message]),
      [
        [
          'People/Omar Haddad.md',
          3,
          'team',
          'team holds one value, but Omar Haddad is given 2: Credit (written here) or Rates (its members).',
        ],
      ],
    );
  });

  test('lists a row’s fields in the table’s order, empty ones too, then its other reverses', () => {
    assert.deepStrictEqual(
      types.fields('@dana').map((field) => [field.name, field.source, field.values.length]),
      [
        ['team', 'merged', 1],
        ['email', 'written', 1],
        ['start', 'written', 1],
        ['remote', 'written', 1],
        ['lead of', 'reverse', 1],
        ['owner of', 'reverse', 1],
      ],
    );
    assert.deepStrictEqual(
      types.fields('#team/credit').filter((field) => field.values.length === 0).map((field) => field.name),
      ['owns', 'headcount', 'on-call'],
    );
  });

  test('follows paths through relations and reverses, up to the limit', () => {
    assert.deepStrictEqual(types.path('@dana', 'team.lead').map((value) => [value.rowId, value.trail]), [['@dana', ['#team/rates']]]);
    assert.deepStrictEqual(types.path('#area/bond-trading', 'owned-by.lead').map((value) => value.rowId), ['@dana']);
    assert.deepStrictEqual(types.path('#area/bond-trading', 'owned-by.lead.email').map((value) => value.text), ['dana@example.com']);
    assert.deepStrictEqual(types.path('#area/bond-trading', ['owned-by', 'lead', 'team', 'lead']), [], `at most ${MAX_PATH_SEGMENTS}`);
    assert.deepStrictEqual(types.path('file:Incidents/RFQ outage.md', 'team.members').map((value) => value.rowId), ['@dana', '@omar']);
    assert.deepStrictEqual(types.path('@dana', 'nothing.lead'), []);
  });

  test('reaches a schema field whose name a built-in takes as field.<name>', () => {
    const status = getTypeIndex(
      indexOf({
        'Types/Team.md': '---\ndeckard-type: team\nrows: "#team/*"\n---\n| Field | Kind |\n| - | - |\n| status | Text |',
        'Teams/Rates.md': '---\ndescribes: "#team/rates"\nstatus: active\n---',
      }),
    );
    assert.strictEqual(status.field('#team/rates', 'field.status')?.values[0].text, 'active');
    assert.strictEqual(status.path('#team/rates', 'field.status')[0]?.text, 'active');
    assert.ok(status.problems.some((problem) => problem.code === 'built-in-name'));
  });
});

suite('Types: computed fields', () => {
  const index = workspace();
  const types = getTypeIndex(index);

  test('counts open tasks, with overdue', () => {
    const rates = types.computed('#team/rates', now);
    assert.deepStrictEqual([rates.openTasks, rates.overdue], [1, 1]);
    assert.strictEqual(types.field('#team/rates', 'open-tasks', now)?.values[0].number, 1);
    assert.deepStrictEqual([types.computed('#team/fx/options', now).openTasks, types.computed('#team/fx', now).openTasks], [1, 0]);
  });

  test('dates the latest mention and counts those of the last 30 days, the hub note aside', () => {
    const rates = types.computed('#team/rates', now);
    assert.strictEqual(rates.lastMentioned, now - 2 * DAY);
    assert.strictEqual(rates.mentions, 1, 'the offsite was 60 days ago');
    const lastMentioned = types.field('#team/rates', 'last-mentioned', now)?.values[0];
    assert.match(lastMentioned?.date ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(types.computed('#team/credit', now).lastMentioned, now, 'Omar’s note names it as a tag');
    assert.strictEqual(types.computed('#team/fx', now).lastMentioned, undefined);
  });

  test('a note row is mentioned by the notes that link to it', () => {
    const outage = types.computed('file:Incidents/RFQ outage.md', now);
    assert.deepStrictEqual(outage.linkedFrom, ['Incidents/Feed lag.md', 'notes/review.md']);
    assert.strictEqual(outage.lastMentioned, now);
    assert.strictEqual(outage.mentions, 2);
    assert.deepStrictEqual(
      types.field('file:Incidents/RFQ outage.md', 'linked-from', now)?.values.map((value) => value.rowId ?? value.notePath),
      ['file:Incidents/Feed lag.md', 'notes/review.md'],
    );
  });
});

suite('Types: the index', () => {
  test('keeps Types/ notes out of the notes, entries, tags, and search, and reads them as types', () => {
    const index = workspace();
    assert.ok(![...index.files.keys()].some((filePath) => filePath.startsWith('Types/')));
    assert.deepStrictEqual([...(index.typeNotes?.keys() ?? [])], ['Types/Person.md', 'Types/Team.md', 'Types/Area.md', 'Types/Incident.md']);
    assert.ok(![...index.sections.values()].some((section) => section.filePath.startsWith('Types/')));
    assert.ok(!(index.tags.get('#team/rates')?.filePaths ?? []).some((filePath) => filePath.startsWith('Types/')));
    assert.deepStrictEqual(createSearchEntries(parse('Types/Team.md', TEAM_TYPE)), []);
    assert.strictEqual(getTypeIndex(index).registry.size, 4);
    assert.strictEqual(indexOf({ 'a.md': '# A' }).typeNotes, undefined, 'absent when there are none');
  });

  test('the scanner reads notes in Types/ as types', async () => {
    const workspaceUri = fileUri('/tmp/deckard-types');
    const typeUri = joinUri(workspaceUri, 'Types', 'Team.md');
    const noteUri = joinUri(workspaceUri, 'Teams', 'Rates.md');
    const folder = { uri: workspaceUri, name: 'deckard-types', index: 0 };
    const scanner = new WorkspaceScanner(
      createFakeAccess({
        workspaceFolders: [folder],
        findFiles: async () => [typeUri, noteUri],
        readFile: async (uri) =>
          Buffer.from(uri.path.endsWith('Team.md') ? TEAM_TYPE : '---\ndescribes: "#team/rates"\nlead: "@dana"\n---\n# Rates', 'utf8'),
      }),
    );
    assert.strictEqual(scanner.getTypesFolderUri(folder).path, '/tmp/deckard-types/Types');
    assert.ok(scanner.parse(typeUri, TEAM_TYPE).typeNote);
    assert.strictEqual(scanner.parse(noteUri, '# Rates').typeNote, undefined);
    const indexer = createWorkspaceIndex({ scanner });
    try {
      await indexer.refresh();
      assert.deepStrictEqual([...indexer.getSnapshot().files.keys()], ['Teams/Rates.md']);
      assert.deepStrictEqual(indexer.getTypeIndex().rows('team').map((row) => row.id), ['#team/rates']);
      assert.strictEqual(indexer.getTypeIndex(), indexer.getTypeIndex(), 'one per index');
    } finally {
      indexer.dispose();
    }
  });

  test('a change to a type note or a row note makes a new type index', () => {
    const team = parse('Types/Team.md', TEAM_TYPE);
    const rates = parse('Teams/Rates.md', '---\ndescribes: "#team/rates"\nheadcount: 4\n---');
    const state = IndexState.build([team, rates]);
    const first = state.snapshot();
    const before = getTypeIndex(first);
    assert.strictEqual(getTypeIndex(first), before);
    assert.strictEqual(before.field('#team/rates', 'headcount')?.values[0].number, 4);
    state.apply([{ filePath: 'Teams/Rates.md', file: parse('Teams/Rates.md', '---\ndescribes: "#team/rates"\nheadcount: 5\n---') }]);
    const second = state.snapshot();
    assert.strictEqual(getTypeIndex(second).field('#team/rates', 'headcount')?.values[0].number, 5);
    state.apply([{ filePath: 'Types/Team.md', file: parse('Types/Team.md', TEAM_TYPE.replace('| headcount | Number', '| headcount | Text  ')) }]);
    assert.strictEqual(getTypeIndex(state.snapshot()).field('#team/rates', 'headcount')?.values[0].number, undefined);
    state.apply([{ filePath: 'Types/Team.md' }]);
    const third = state.snapshot();
    assert.strictEqual(third.typeNotes, undefined);
    assert.ok(getTypeIndex(third).isEmpty);
    assert.ok(getTypeIndex(third) instanceof TypeIndex);
  });
});

suite('Types: parsed notes', () => {
  test('the parse format changed, so the cache rebuilds with properties', () => {
    assert.strictEqual(PARSE_FORMAT, 'note-properties');
  });

  test('keeps every front-matter key of every note, with tags and lines, and its type', () => {
    const file = parseMarkdown(
      'People/Dana.md',
      ['---', 'type: Person', 'team: rates', 'people:', '  - dana', '  - "@omar"', 'aliases: ["@dw"]', '---', '# Dana'].join('\n'),
    );
    assert.strictEqual(file.typeKey, 'Person');
    assert.strictEqual(file.hub, undefined, 'not a hub');
    assert.deepStrictEqual(file.properties, [
      { name: 'type', line: 2, values: [{ text: 'Person', line: 2 }] },
      { name: 'team', line: 3, values: [{ text: 'rates', line: 3 }] },
      {
        name: 'people',
        line: 4,
        values: [
          { text: 'dana', tag: { key: '@dana', label: '@dana' }, line: 5 },
          { text: '@omar', tag: { key: '@omar', label: '@omar' }, line: 6 },
        ],
      },
      { name: 'aliases', line: 7, values: [{ text: '@dw', line: 7 }] },
    ]);
    assert.strictEqual(parseMarkdown('a.md', '# A').properties, undefined);
  });

  test('a note with its properties and a type note round-trip through the cache', () => {
    const note = parse('Teams/Rates.md', '---\ndescribes: "#team/rates"\nlead: "@dana"\n---\n# Rates');
    const typeNote = parse('Types/Team.md', TEAM_TYPE);
    assert.deepStrictEqual(decodeParsedFile(encodeParsedFile(note)), note);
    assert.deepStrictEqual(decodeParsedFile(encodeParsedFile(typeNote)), typeNote);
  });
});
