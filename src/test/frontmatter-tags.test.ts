import * as assert from 'assert';

import {
  addFrontmatterTag,
  findTagsFieldProblem,
  formatYamlValue,
  readFrontmatterTagValues,
  removeFrontmatterTags,
} from '../domain/markdown/frontmatterTags';
import { parseMarkdown } from '../domain/markdown/parser';

suite('Front matter tags', () => {
  test('adds a front matter to a note that has none', () => {
    assert.strictEqual(addFrontmatterTag('# Atlas\nBody\n', 'parked'), '---\ntags: [parked]\n---\n# Atlas\nBody\n');
  });

  test('adds a tags field to a front matter without one', () => {
    assert.strictEqual(
      addFrontmatterTag('---\ntitle: Atlas\n---\n# Atlas\n', 'parked'),
      '---\ntitle: Atlas\ntags: [parked]\n---\n# Atlas\n',
    );
  });

  test('adds to a flow list, a single value, and a block list', () => {
    assert.strictEqual(
      addFrontmatterTag('---\ntags: [a, "b"]\n---\n', 'parked'),
      '---\ntags: [a, b, parked]\n---\n',
    );
    assert.strictEqual(addFrontmatterTag('---\ntag: a\n---\n', 'parked'), '---\ntag: [a, parked]\n---\n');
    assert.strictEqual(
      addFrontmatterTag('---\ntags:\n  - a\n  - b\ntitle: x\n---\n', 'parked'),
      '---\ntags:\n  - a\n  - b\n  - parked\ntitle: x\n---\n',
    );
  });

  test('leaves a note alone that has the tag, in any spelling', () => {
    assert.strictEqual(addFrontmatterTag('---\ntags: [Parked]\n---\n', 'parked'), undefined);
    assert.strictEqual(addFrontmatterTag('---\ntags:\n  - "#parked"\n---\n', 'parked'), undefined);
  });

  test('keeps CRLF line endings', () => {
    assert.strictEqual(addFrontmatterTag('---\r\ntitle: x\r\n---\r\nBody', 'parked'), '---\r\ntitle: x\r\ntags: [parked]\r\n---\r\nBody');
    assert.strictEqual(addFrontmatterTag('Body\r\n', 'parked'), '---\r\ntags: [parked]\r\n---\r\nBody\r\n');
  });

  test('refuses a front matter it cannot safely rewrite', () => {
    assert.strictEqual(addFrontmatterTag('---\ntags: [a,\n  b]\n---\n', 'parked'), undefined);
    assert.strictEqual(removeFrontmatterTags('---\ntags: a\n  - b\n---\n', ['a']), undefined);
    assert.strictEqual(readFrontmatterTagValues('---\ntags: [a,\n  b]\n---\n'), undefined);
  });

  test('removes a tag and keeps the rest', () => {
    assert.strictEqual(
      removeFrontmatterTags('---\ntags: [a, parked, b]\n---\n', ['parked']),
      '---\ntags: [a, b]\n---\n',
    );
    assert.strictEqual(
      removeFrontmatterTags('---\ntags:\n  - a\n  - "#Parked"\n---\n', ['parked']),
      '---\ntags:\n  - a\n---\n',
    );
  });

  test('an emptied field goes, and an emptied front matter goes with it', () => {
    assert.strictEqual(
      removeFrontmatterTags('---\ntitle: x\ntags: [parked]\n---\n# A\n', ['parked']),
      '---\ntitle: x\n---\n# A\n',
    );
    assert.strictEqual(removeFrontmatterTags('---\ntags: [parked]\n---\n# A\n', ['parked']), '# A\n');
    assert.strictEqual(
      removeFrontmatterTags(addFrontmatterTag('# A\r\nBody', 'parked') as string, ['parked']),
      '# A\r\nBody',
    );
    assert.strictEqual(
      removeFrontmatterTags('---\ntags:\n  - parked\n---\nBody', ['parked', 'someday']),
      'Body',
    );
  });

  test('an empty value names no tag, and a rewrite leaves none behind and keeps every other key', () => {
    const empties = (list: string) => `---\ntitle: x\ntags:\n${list}owner: y\n---\n# A\n`;
    for (const empty of ["''", '""']) {
      assert.deepStrictEqual(readFrontmatterTagValues(`---\ntags: ${empty}\n---\n`), [], empty);
      assert.strictEqual(
        addFrontmatterTag(`---\ntitle: x\ntags: ${empty}\nowner: y\n---\n`, 'parked'),
        '---\ntitle: x\ntags: [parked]\nowner: y\n---\n',
        empty,
      );
      assert.strictEqual(removeFrontmatterTags(`---\ntags: ${empty}\n---\n`, ['parked']), undefined, empty);

      assert.deepStrictEqual(readFrontmatterTagValues(empties(`  - ${empty}\n  - parked\n`)), ['parked'], empty);
      assert.strictEqual(
        removeFrontmatterTags(empties(`  - ${empty}\n  - parked\n`), ['parked']),
        '---\ntitle: x\nowner: y\n---\n# A\n',
        `${empty}: the field goes once no tag is left in it`,
      );
      assert.strictEqual(
        removeFrontmatterTags(empties(`  - a\n  - ${empty}\n  - parked\n`), ['parked']),
        empties('  - a\n'),
        `${empty}: the empty item goes with the rewrite`,
      );
      assert.strictEqual(
        addFrontmatterTag(empties(`  - ${empty}\n`), 'parked'),
        empties('  - parked\n'),
        `${empty}: the new tag takes the empty item's place`,
      );
      assert.strictEqual(removeFrontmatterTags(empties(`  - ${empty}\n`), ['parked']), undefined, empty);
    }
  });

  test('reads both tags: and tag:, as the parser does', () => {
    const both = "---\ntags: ''\ntag: [parked]\n---\n# Atlas\n";
    assert.deepStrictEqual(readFrontmatterTagValues(both), ['parked']);
    assert.strictEqual(addFrontmatterTag(both, 'parked'), undefined, 'Park finds the tag already there');
    assert.strictEqual(removeFrontmatterTags(both, ['parked']), "---\ntags: ''\n---\n# Atlas\n", 'Unpark takes it out of tag:');
    assert.strictEqual(
      addFrontmatterTag(both, 'later'),
      "---\ntags: ''\ntag: [parked, later]\n---\n# Atlas\n",
      'a new tag joins the field that names tags',
    );
    const split = '---\ntags: [a, parked]\ntag:\n  - parked\n  - b\n---\n';
    assert.deepStrictEqual(readFrontmatterTagValues(split), ['a', 'parked', 'parked', 'b']);
    assert.strictEqual(removeFrontmatterTags(split, ['parked']), '---\ntags: [a]\ntag:\n  - b\n---\n', 'out of both');
    assert.strictEqual(removeFrontmatterTags('---\ntag: parked\ntags:\n  - parked\n---\nBody\n', ['parked']), 'Body\n');
    // A field written twice is read where it is written last, as the parser reads it.
    assert.deepStrictEqual(readFrontmatterTagValues('---\ntags: [old]\ntitle: x\ntags: [new]\n---\n'), ['new']);
  });

  test('reads a block list written without indentation, as the parser does', () => {
    const note = '---\ntitle: Old plan\ntags:\n- parked\n- archive\n---\n# Old plan\n';
    assert.deepStrictEqual(
      parseMarkdown('old.md', note).frontmatterTags.map((tag) => tag.key),
      ['#parked', '#archive'],
      'the parser reads both items',
    );
    assert.deepStrictEqual(readFrontmatterTagValues(note), ['parked', 'archive']);
    assert.strictEqual(
      removeFrontmatterTags(note, ['parked']),
      '---\ntitle: Old plan\ntags:\n- archive\n---\n# Old plan\n',
      'Unpark takes the item out',
    );
    assert.strictEqual(
      addFrontmatterTag(note, 'work'),
      '---\ntitle: Old plan\ntags:\n- parked\n- archive\n- work\n---\n# Old plan\n',
      'Park adds to the list rather than writing a second value',
    );
    assert.strictEqual(addFrontmatterTag(note, 'parked'), undefined, 'Park finds the tag already there');
  });

  test('quotes a value YAML would misread unquoted, and only such a value', () => {
    assert.strictEqual(addFrontmatterTag('---\ntags: ["#atlas"]\n---\n', 'parked'), '---\ntags: ["#atlas", parked]\n---\n');
    assert.strictEqual(addFrontmatterTag('---\ntags: ["@dana"]\n---\n', 'parked'), '---\ntags: ["@dana", parked]\n---\n');
    assert.strictEqual(addFrontmatterTag("---\ntags: ['a: b']\n---\n", 'parked'), '---\ntags: ["a: b", parked]\n---\n');
    assert.strictEqual(addFrontmatterTag('---\ntags: "#atlas"\n---\n', 'parked'), '---\ntags: ["#atlas", parked]\n---\n');
    assert.strictEqual(
      addFrontmatterTag('---\ntags: [#a, #b]\n---\n', 'parked'),
      '---\ntags: ["#a", "#b", parked]\n---\n',
      'tags the parser reads, written so YAML reads them too',
    );
    assert.strictEqual(addFrontmatterTag('# A\n', 'yes'), '---\ntags: ["yes"]\n---\n# A\n');
    assert.strictEqual(addFrontmatterTag('---\ntags:\n  - a\n---\n', 'null'), '---\ntags:\n  - a\n  - "null"\n---\n');
    assert.strictEqual(
      removeFrontmatterTags('---\ntags: ["#atlas", parked]\n---\nx\n', ['#parked']),
      '---\ntags: ["#atlas"]\n---\nx\n',
    );
    assert.strictEqual(formatYamlValue('a, b', 'list'), '"a, b"', 'a comma ends a value only inside a list');
    assert.strictEqual(formatYamlValue('a, b', 'line'), 'a, b');
    assert.strictEqual(formatYamlValue('-x', 'list'), '-x');
    assert.strictEqual(formatYamlValue('say "hi" #x', 'list'), `'say "hi" #x'`);
    assert.strictEqual(formatYamlValue("it's", 'list'), "it's");
  });

  test('leaves a tags line alone that ends in a comment, and says so', () => {
    for (const note of [
      '---\ntags: [a] # mine\n---\n',
      '---\ntags: a # mine\n---\n',
      '---\ntags:\n  - a # mine\n  - parked\n---\n',
    ]) {
      assert.strictEqual(addFrontmatterTag(note, 'parked'), undefined, note);
      assert.strictEqual(removeFrontmatterTags(note, ['parked']), undefined, note);
      assert.strictEqual(findTagsFieldProblem(note), 'comment', note);
    }
    assert.strictEqual(
      addFrontmatterTag('---\ntags: ["a # b"]\n---\n', 'parked'),
      '---\ntags: ["a # b", parked]\n---\n',
      'a # inside quotes is part of the value',
    );
    assert.strictEqual(findTagsFieldProblem('---\ntags: [a,\n  b]\n---\n'), 'unreadable');
    assert.strictEqual(findTagsFieldProblem('---\ntags: [a]\n---\n'), undefined);
  });

  test('leaves a quoted value with a comma alone, which YAML reads as one value and the parser as two', () => {
    assert.strictEqual(addFrontmatterTag('---\ntags: ["a, b"]\n---\n', 'parked'), undefined);
    assert.strictEqual(addFrontmatterTag("---\ntags: [it's, b]\n---\n", 'parked'), "---\ntags: [it's, b, parked]\n---\n");
  });

  test('says when there was nothing to remove', () => {
    assert.strictEqual(removeFrontmatterTags('# A\n', ['parked']), undefined);
    assert.strictEqual(removeFrontmatterTags('---\ntags: [a]\n---\n', ['parked']), undefined);
  });
});
