import * as assert from 'assert';

import { setFrontmatterField, type FrontmatterFieldEdit, type FrontmatterWriteValue } from '../domain/types/frontmatterWriter';

const lines = (...text: string[]): string => text.join('\n');
const values = (...texts: string[]): FrontmatterWriteValue[] => texts.map((text) => ({ text }));

/** The note after a write, or a failure naming what the write came to instead. */
function written(edit: FrontmatterFieldEdit): string {
  assert.strictEqual(edit.kind, 'edit', `wrote nothing: ${JSON.stringify(edit)}`);
  return edit.kind === 'edit' ? edit.content : '';
}

const NOTE = lines(
  '---',
  'describes: "#team/rates"',
  "lead: '@dana'   # since March",
  'owns: [bond trading, "#area/fx"]',
  'Status : active',
  '# a comment between keys',
  'members:',
  '  - "@dana"   # lead',
  '  - "@omar"',
  'channel:',
  '---',
  '# Rates',
  'Body.',
);

suite('Front matter: writing one key', () => {
  test('sets a single value in place, keeping its comment and every other line', () => {
    const edit = setFrontmatterField(NOTE, 'lead', { values: values('@omar') });
    assert.strictEqual(
      written(edit),
      NOTE.replace("lead: '@dana'   # since March", 'lead: "@omar"   # since March'),
      'a tag is written in double quotes, the comment kept',
    );
    assert.deepStrictEqual(edit.kind === 'edit' && [edit.start, edit.deleted, edit.lines, edit.line], [2, 1, ['lead: "@omar"   # since March'], 3]);
  });

  test('matches the key in any case and keeps its spelling and spacing', () => {
    assert.strictEqual(written(setFrontmatterField(NOTE, 'status', { values: values('paused') })), NOTE.replace('Status : active', 'Status : paused'));
  });

  test('keeps the quote a value had when the new one needs none', () => {
    const quoted = lines('---', "status: 'active'", 'tier: "gold"', '---');
    assert.strictEqual(written(setFrontmatterField(quoted, 'status', { values: values('paused') })), quoted.replace("'active'", "'paused'"));
    assert.strictEqual(written(setFrontmatterField(quoted, 'status', { values: values("it's done") })), quoted.replace("'active'", "'it''s done'"));
    assert.strictEqual(written(setFrontmatterField(quoted, 'tier', { values: values('silver') })), quoted.replace('"gold"', '"silver"'));
  });

  test('quotes only where YAML would misread a value, and writes a bare value as it is', () => {
    const note = lines('---', 'a: x', '---');
    const set = (text: string, bare?: boolean) => written(setFrontmatterField(note, 'a', { values: [{ text, ...(bare ? { bare } : {}) }] })).split('\n')[1];
    assert.strictEqual(set('Head of Rates'), 'a: Head of Rates');
    assert.strictEqual(set('[[RFQ outage]]'), 'a: "[[RFQ outage]]"');
    assert.strictEqual(set('#team/rates'), 'a: "#team/rates"');
    assert.strictEqual(set('yes'), 'a: "yes"', 'a word YAML reads as true is text here');
    assert.strictEqual(set('true', true), 'a: true');
    assert.strictEqual(set('12', true), 'a: 12');
    assert.strictEqual(set('2026-03-01'), 'a: 2026-03-01');
    assert.strictEqual(set('a: b'), 'a: "a: b"');
  });

  test('writes several values as a flow list, in a flow list kept with its comment', () => {
    const edit = setFrontmatterField(NOTE, 'owns', { values: values('#area/bond-trading', '#area/fx'), list: true });
    assert.strictEqual(written(edit), NOTE.replace('owns: [bond trading, "#area/fx"]', 'owns: ["#area/bond-trading", "#area/fx"]'));
    const commented = lines('---', 'owns: [a] # areas', '---');
    assert.strictEqual(written(setFrontmatterField(commented, 'owns', { values: values('b', 'c, d'), list: true })), lines('---', 'owns: [b, "c, d"] # areas', '---'));
    assert.strictEqual(
      written(setFrontmatterField(lines('---', 'owns: a', '---'), 'owns', { values: values('#area/a'), list: true })),
      lines('---', 'owns: ["#area/a"]', '---'),
      'a field that holds several is a list even with one',
    );
  });

  test('keeps a block list a block list: the kept items as written, new ones after the last', () => {
    const edit = setFrontmatterField(NOTE, 'members', { values: values('@dana', '@priya'), list: true });
    assert.strictEqual(
      written(edit),
      NOTE.replace('  - "@omar"', '  - "@priya"'),
      '@dana and its comment stay, @omar goes, @priya follows',
    );
    const commented = lines('---', 'tags:', '- a', '# between', '- b', '---');
    assert.strictEqual(
      written(setFrontmatterField(commented, 'tags', { values: values('a', 'b', 'c'), list: true })),
      lines('---', 'tags:', '- a', '# between', '- b', '- c', '---'),
      'at the column the list is written at',
    );
  });

  test('writes one value on the key’s line when the field holds one, a list under it dropped', () => {
    const list = lines('---', 'lead:', '  - "@dana"', 'x: 1', '---');
    assert.strictEqual(written(setFrontmatterField(list, 'lead', { values: values('@omar') })), lines('---', 'lead: "@omar"', 'x: 1', '---'));
  });

  test('fills an empty key where it is', () => {
    assert.strictEqual(written(setFrontmatterField(NOTE, 'channel', { values: values('#rates-help') })), NOTE.replace('channel:', 'channel: "#rates-help"'));
    const commented = lines('---', 'email: # ask', '---');
    assert.strictEqual(written(setFrontmatterField(commented, 'email', { values: values('a@b.c') })), lines('---', 'email: a@b.c # ask', '---'));
  });

  test('adds a missing key after the last key, before comments and blank lines that close the front matter', () => {
    const note = lines('---', 'a: 1', 'b:', '  - x', '', '# end', '---', 'Body');
    const edit = setFrontmatterField(note, 'tier', { values: values('gold') });
    assert.strictEqual(written(edit), lines('---', 'a: 1', 'b:', '  - x', 'tier: gold', '', '# end', '---', 'Body'));
    assert.deepStrictEqual(edit.kind === 'edit' && [edit.start, edit.deleted, edit.line], [4, 0, 5]);
    assert.strictEqual(written(setFrontmatterField(lines('---', '---', '# T'), 'tier', { values: values('gold') })), lines('---', 'tier: gold', '---', '# T'));
  });

  test('gives a note with no front matter one', () => {
    const edit = setFrontmatterField('# Dana\nBody.', 'team', { values: values('#team/rates') });
    assert.strictEqual(written(edit), '---\nteam: "#team/rates"\n---\n# Dana\nBody.');
    assert.deepStrictEqual(edit.kind === 'edit' && [edit.start, edit.deleted, edit.line], [0, 0, 2]);
    assert.deepStrictEqual(setFrontmatterField('# Dana', 'team', { values: [] }), { kind: 'unchanged' });
  });

  test('clears a key with the lines under it', () => {
    const edit = setFrontmatterField(NOTE, 'members', { values: [] });
    assert.strictEqual(written(edit), NOTE.replace('members:\n  - "@dana"   # lead\n  - "@omar"\n', ''));
    assert.strictEqual(edit.kind === 'edit' ? edit.line : 'none', undefined);
    assert.deepStrictEqual(setFrontmatterField(NOTE, 'email', { values: [] }), { kind: 'unchanged' }, 'a key not written is already clear');
  });

  test('writes the key the parser reads when it is written twice: the last', () => {
    const twice = lines('---', 'a: 1', 'a: 2', '---');
    assert.strictEqual(written(setFrontmatterField(twice, 'a', { values: values('3') })), lines('---', 'a: 1', 'a: 3', '---'));
  });

  test('keeps the note’s line endings', () => {
    const crlf = NOTE.replace(/\n/g, '\r\n');
    assert.strictEqual(written(setFrontmatterField(crlf, 'lead', { values: values('@omar') })), crlf.replace("'@dana'", '"@omar"'));
    assert.strictEqual(written(setFrontmatterField('# T\r\n', 'a', { values: values('b') })), '---\r\na: b\r\n---\r\n# T\r\n');
  });

  test('says nothing changed when the value is already written so', () => {
    assert.deepStrictEqual(setFrontmatterField(NOTE, 'status', { values: values('active') }), { kind: 'unchanged' });
    assert.deepStrictEqual(setFrontmatterField(NOTE, 'members', { values: values('@dana', '@omar'), list: true }), { kind: 'unchanged' });
  });

  test('refuses what it cannot rewrite safely, with the line to open the editor at', () => {
    const refused = (note: string, key: string) => setFrontmatterField(note, key, { values: values('x') });
    assert.deepStrictEqual(refused(lines('---', 'a: 1', 'about: |', '  Two', '  lines', '---'), 'about'), { kind: 'refused', reason: 'block-scalar', line: 3 });
    assert.deepStrictEqual(refused(lines('---', 'about: >-', '  folded', '---'), 'about'), { kind: 'refused', reason: 'block-scalar', line: 2 });
    assert.deepStrictEqual(refused(lines('---', 'contact:', '  email: a@b.c', '---'), 'contact'), { kind: 'refused', reason: 'nested', line: 3 });
    assert.deepStrictEqual(refused(lines('---', 'contact: {email: a@b.c}', '---'), 'contact'), { kind: 'refused', reason: 'nested', line: 2 });
    assert.deepStrictEqual(refused(lines('---', 'people:', '  - name: Dana', '---'), 'people'), { kind: 'refused', reason: 'nested', line: 3 });
    assert.deepStrictEqual(refused(lines('---', 'owns: [a,', '  b]', '---'), 'owns'), { kind: 'refused', reason: 'unreadable', line: 2 });
    assert.deepStrictEqual(refused(lines('---', 'desc: "two', '  lines"', '---'), 'desc'), { kind: 'refused', reason: 'unreadable', line: 2 });
    assert.deepStrictEqual(refused(lines('---', 'desc: words', '  run on', '---'), 'desc'), { kind: 'refused', reason: 'unreadable', line: 3 });
    assert.deepStrictEqual(refused(lines('---', 'lead: *boss', '---'), 'lead'), { kind: 'refused', reason: 'unreadable', line: 2 });
    assert.deepStrictEqual(refused(NOTE, 'not a key'), { kind: 'refused', reason: 'bad-key', line: 1 });
  });

  test('reads a comment only outside quotes and brackets, and a value that opens with # as a value', () => {
    const note = lines('---', 'a: "x # y"   # real', 'b: [p, "q # r"] # list', 'c: #team/rates', '---');
    assert.strictEqual(written(setFrontmatterField(note, 'a', { values: values('z') })).split('\n')[1], 'a: "z"   # real');
    assert.strictEqual(written(setFrontmatterField(note, 'b', { values: values('s'), list: true })).split('\n')[2], 'b: [s] # list');
    assert.strictEqual(written(setFrontmatterField(note, 'c', { values: values('#team/credit') })).split('\n')[3], 'c: "#team/credit"');
  });
});
