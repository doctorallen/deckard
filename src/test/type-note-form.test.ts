import * as assert from 'assert';

import { getTypeIndex } from '../domain/types/typeIndex';
import { setDraftValues, startTypedNoteDraft, type DraftType } from '../domain/types/typedNoteDraft';
import {
  createTypeNoteFormRows,
  describeDraftValues,
  findStartField,
  findTypedHubStart,
  kindIcon,
  listFolderChoices,
  listTypeChoices,
  previewTypeNoteForm,
  titleTypeNoteForm,
} from '../ui/state/typeNoteForm';
import { indexOf, typedWorkspace } from './typedWorkspace';

const index = typedWorkspace();
const types = getTypeIndex(index);

/** A type of the typed workspace, which every test expects there. */
function typeOf(key: string): DraftType {
  const type = types.registry.get(key);
  assert.ok(type, key);
  return type;
}

suite('The form for a new note of a type', () => {
  test('a namespace type\'s rows: Folder, Title, Tag, its fields in the schema\'s order, then Create the note', () => {
    const team = typeOf('team');
    const draft = startTypedNoteDraft(team);
    assert.deepStrictEqual(createTypeNoteFormRows(team, draft), [
      { label: '$(file) Folder', description: 'Teams/ · the team folder', row: 'folder' },
      { label: '$(pencil) Title', description: 'Empty', row: 'title' },
      { label: '$(tag) Tag', description: 'Not set', row: 'tag' },
      { label: 'Fields', separator: true },
      { label: '$(person) lead', description: 'Not set', row: 'field', fieldKey: 'lead' },
      { label: '$(link) owns', description: 'Not set', row: 'field', fieldKey: 'owns' },
      { label: '$(list-selection) tier', description: 'Not set', row: 'field', fieldKey: 'tier' },
      { label: '$(symbol-number) headcount', description: 'Not set', row: 'field', fieldKey: 'headcount' },
      { label: '$(person) on-call', description: 'Not set', row: 'field', fieldKey: 'on-call' },
      { label: '$(symbol-text) status', description: 'Not set', row: 'field', fieldKey: 'status' },
      { label: '', separator: true },
      { label: '$(save) Create the note', description: 'Enter', done: true },
    ]);
    assert.strictEqual(titleTypeNoteForm(team, draft), 'Add a team to Teams/');
    assert.strictEqual(previewTypeNoteForm(team, draft), 'Teams/ · Choose Title to name the note');
  });

  test('says each value set, the tag the title gives, and where the note will be written', () => {
    const team = typeOf('team');
    let draft = startTypedNoteDraft(team, { title: 'Risk Tech' });
    draft = setDraftValues(draft, 'lead', [{ text: '@dana', title: 'Dana Whitfield' }]);
    draft = setDraftValues(draft, 'owns', [{ text: '#area/fx', title: 'FX' }, { text: 'payments' }]);
    draft = setDraftValues(draft, 'headcount', [{ text: '12' }]);
    const rows = createTypeNoteFormRows(team, draft);
    const said = Object.fromEntries(rows.filter((row) => row.row).map((row) => [row.fieldKey ?? row.row, row.description]));
    assert.deepStrictEqual(said, {
      folder: 'Teams/ · the team folder',
      title: 'Risk Tech',
      tag: '#team/risk-tech · from the title',
      lead: 'Dana Whitfield',
      owns: 'FX, payments',
      tier: 'Not set',
      headcount: '12',
      'on-call': 'Not set',
      status: 'Not set',
    });
    assert.strictEqual(previewTypeNoteForm(team, draft), 'Teams/Risk Tech.md · #team/risk-tech');
    const edited = { ...draft, tag: '#team/risk', folder: 'Teams/EMEA' };
    assert.strictEqual(createTypeNoteFormRows(team, edited).find((row) => row.row === 'tag')?.description, '#team/risk');
    assert.strictEqual(createTypeNoteFormRows(team, edited)[0].description, 'Teams/EMEA/');
    assert.strictEqual(titleTypeNoteForm(team, edited), 'Add a team to Teams/EMEA/');
    assert.strictEqual(previewTypeNoteForm(team, edited), 'Teams/EMEA/Risk Tech.md · #team/risk');
    const given = startTypedNoteDraft(team, { title: 'Rates', tag: '#team/rates' });
    assert.strictEqual(createTypeNoteFormRows(team, given)[2].description, '#team/rates · the tag this note describes');
    assert.strictEqual(titleTypeNoteForm(team, { folder: '' }), 'Add a team to the notes folder');
  });

  test('a note type\'s rows have no Tag, and its title takes "an"', () => {
    const incident = typeOf('incident');
    const draft = startTypedNoteDraft(incident, { title: 'Feed outage' });
    const rows = createTypeNoteFormRows(incident, draft);
    assert.deepStrictEqual(rows.map((row) => row.label), [
      '$(file) Folder',
      '$(pencil) Title',
      'Fields',
      '$(person) owner',
      '$(link) team',
      '$(list-selection) severity',
      '',
      '$(save) Create the note',
    ]);
    assert.strictEqual(titleTypeNoteForm(incident, draft), 'Add an incident to Incidents/');
    assert.strictEqual(previewTypeNoteForm(incident, draft), 'Incidents/Feed outage.md');
  });

  test('a type with no fields has no Fields group, and a problem is said on its row', () => {
    const plain: DraftType = { key: 'person', name: 'Person', rows: { kind: 'tags', prefix: '@', written: '@*' }, fields: [] };
    const draft = startTypedNoteDraft(plain, { title: 'Omar H' });
    const rows = createTypeNoteFormRows(plain, draft, { problem: { row: 'tag', message: '@omar-h already has a hub note, People/Omar.md.' } });
    assert.deepStrictEqual(rows.map((row) => row.label), ['$(file) Folder', '$(pencil) Title', '$(tag) Tag', '', '$(save) Create the note']);
    assert.strictEqual(rows[2].description, '$(error) @omar-h already has a hub note, People/Omar.md.');
    assert.strictEqual(rows[0].description, 'People/ · the person folder');
  });

  test('each kind has its icon, and values are said by kind', () => {
    assert.deepStrictEqual(
      (['person', 'relation', 'select', 'date', 'number', 'checkbox', 'email', 'link', 'phone', 'note', 'text'] as const).map((name) => kindIcon({ name })),
      ['person', 'link', 'list-selection', 'calendar', 'symbol-number', 'check', 'mail', 'link-external', 'device-mobile', 'note', 'symbol-text'],
    );
    assert.strictEqual(describeDraftValues({ name: 'date' }, [{ text: '2026-10-09' }]), 'Friday 2026-10-09');
    assert.strictEqual(describeDraftValues({ name: 'checkbox' }, [{ text: 'true' }]), 'Yes');
    assert.strictEqual(describeDraftValues({ name: 'checkbox' }, [{ text: 'false' }]), 'No');
    assert.strictEqual(describeDraftValues({ name: 'note' }, [{ text: '[[RFQ outage]]' }]), 'RFQ outage');
    assert.strictEqual(describeDraftValues({ name: 'text' }, [{ text: 'a' }, { text: 'b' }]), 'a, b');
  });

  test('New Note from Type lists the types by name, with where their notes go and how many there are', () => {
    assert.deepStrictEqual(listTypeChoices(types), [
      { label: 'Area', description: 'Areas/ · 2 rows', typeKey: 'area' },
      { label: 'Incident', description: 'type: incident · 2 notes', typeKey: 'incident' },
      { label: 'Person', description: 'People/ · 3 rows', typeKey: 'person' },
      { label: 'Team', description: 'Teams/ · 2 rows', typeKey: 'team' },
    ]);
    assert.deepStrictEqual(listTypeChoices(getTypeIndex(indexOf({ 'notes/a.md': '# A' }))), []);
  });

  test('the Folder row offers the type\'s folder first, then the notes folder, then the rest, most notes first', () => {
    const paths = ['Teams/Rates.md', 'People/Dana.md', 'People/Omar.md', 'People/EMEA/Lena.md', 'standup.md'];
    assert.deepStrictEqual(listFolderChoices(paths, { notesFolder: '', typeFolder: 'Teams' }), [
      { label: 'Teams/', description: '1 note · the type\'s folder', folder: 'Teams' },
      { label: 'The notes folder', description: '5 notes', folder: '' },
      { label: 'People/', description: '3 notes', folder: 'People' },
      { label: 'People/EMEA/', description: '1 note', folder: 'People/EMEA' },
    ]);
    assert.deepStrictEqual(
      listFolderChoices(['notes/Teams/Rates.md', 'other/x.md'], { notesFolder: 'notes', typeFolder: 'Areas' }).map((choice) => choice.label),
      ['Areas/', 'The notes folder', 'Teams/'],
    );
  });

  test('Create hub note opens the form for a tag a type has rows of, and makes a bare hub note for any other', () => {
    assert.deepStrictEqual(findTypedHubStart(index, types, '#area/bond-trading'), { typeKey: 'area', tag: '#area/bond-trading', title: 'Bond Trading' });
    assert.deepStrictEqual(findTypedHubStart(index, types, '#Area/FX'), { typeKey: 'area', tag: '#area/fx', title: 'Fx' });
    assert.strictEqual(findTypedHubStart(index, types, '#project/atlas'), undefined);
    const untyped = indexOf({ 'notes/a.md': '# A #team/rates' });
    assert.strictEqual(findTypedHubStart(untyped, getTypeIndex(untyped), '#team/rates'), undefined);
  });

  test('an Edit on a field Not set opens the form at that field’s input: a field it lists, any case, and nothing for any other key', () => {
    const person = typeOf('person');
    assert.strictEqual(findStartField(person, 'email')?.name, 'email');
    assert.strictEqual(findStartField(person, ' TEAM ')?.key, 'team');
    assert.strictEqual(findStartField(person, undefined), undefined, 'no field asked: the form opens as usual');
    assert.strictEqual(findStartField(person, 'pager'), undefined, 'a key the type does not have');
    const described = { fields: [...person.fields, { key: 'describes', name: 'describes', kind: { name: 'text' as const, many: false } }] };
    assert.strictEqual(findStartField(described, 'describes'), undefined, 'the form writes the note’s identity itself');
  });
});
