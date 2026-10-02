import * as assert from 'assert';

import { findFrontmatterEnd, splitFrontmatterValues, unquote } from '../domain/markdown/frontmatter';
import {
  addFrontmatterTag,
  readFrontmatterTagValues,
  removeFrontmatterTags,
} from '../domain/markdown/frontmatterTags';
import { findTagTarget } from '../domain/markdown/tagTarget';
import { maskNoteForWords } from '../domain/markdown/wordCount';
import { readMoveBlock } from '../domain/markdown/moveLines';
import { parseMarkdown } from '../domain/markdown/parser';
import { readProseLines } from '../domain/markdown/proseExcerpt';
import { findRepeatRuleProblems } from '../domain/markdown/repeatRuleProblems';
import { replaceIndexedTag } from '../domain/markdown/tagRename';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { withoutFrontmatter } from '../domain/notes/embeds';
import { createQueryContext } from '../domain/query/queryContext';
import { getRelevantDate } from '../domain/ranking/recency';
import { findUnlinkedMentions } from '../domain/search/mentions';
import { getFrontmatterBody } from '../ui/state/entryCards';
import { findTaskLineMarks } from '../ui/state/taskLineMarks';

suite('Front matter bounds and values', () => {
  test('front matter closes on --- or on YAML\'s ..., each trimmed', () => {
    assert.strictEqual(findFrontmatterEnd(['---', 'tags: [a]', '---', 'body']), 2);
    assert.strictEqual(findFrontmatterEnd(['---', 'tags: [a]', '...', 'body', '---']), 2);
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b', '  ---  ', 'body']), 2);
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b', '\t...  ']), 2);
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b', '....']), undefined);
  });

  test('a note must open with ---, whitespace around it allowed', () => {
    assert.strictEqual(findFrontmatterEnd([' --- ', 'a: b', '---']), 2);
    assert.strictEqual(findFrontmatterEnd(['...', 'a: b', '...']), undefined);
    assert.strictEqual(findFrontmatterEnd(['# Title', '---', '---']), undefined);
    assert.strictEqual(findFrontmatterEnd([]), undefined);
  });

  test('front matter that never closes is none', () => {
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b']), undefined);
    assert.strictEqual(findFrontmatterEnd(['---']), undefined);
  });

  test('every reader reads front matter closed by ... as it reads front matter closed by ---', () => {
    const note = (closing: string) =>
      [
        '---',
        'tags: [alpha]',
        'created: 2026-01-05',
        'aliases: [Atlas Plan]',
        'todo:',
        '- [ ] Draft 🔁 every blursday',
        closing,
        '# Atlas #alpha',
        'Words about the Atlas Plan.',
        '- [ ] Real task 📅 2020-01-01',
      ].join('\n');
    // A reader that returns the note writes its closing line back as it was.
    const same = (text: string | undefined) => text?.replace('\n...\n', '\n---\n');
    const context = createQueryContext(new Date(2026, 9, 2, 12).getTime());
    const readers: Record<string, (text: string) => unknown> = {
      parser: (text) => {
        const file = parseMarkdown('notes/atlas.md', text);
        return {
          aliases: file.aliases,
          createdAt: file.createdAt,
          sections: file.sections.map((section) => [section.heading, section.tags]),
          tasks: file.tasks.map((task) => [task.title, task.tags]),
          relevantDate: getRelevantDate(file)?.source,
        };
      },
      'front-matter tags': (text) => readFrontmatterTagValues(text),
      'add a tag': (text) => same(addFrontmatterTag(text, 'beta')),
      'remove a tag': (text) => same(removeFrontmatterTags(text, ['alpha'])),
      'rename a tag': (text) =>
        same(replaceIndexedTag(text, '#alpha', { key: '#beta', label: '#beta' }).content),
      'Move to…': (text) =>
        readMoveBlock(text.split('\n'), {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          isEmpty: true,
        }),
      'word count': (text) => maskNoteForWords(text.split('\n')),
      excerpt: (text) => readProseLines(text),
      'tag target': (text) => findTagTarget(text.split('\n'), 3),
      embed: (text) => withoutFrontmatter(text),
      'entry card': (text) => getFrontmatterBody(text),
      'task line marks': (text) => findTaskLineMarks(text.split('\n'), context, { dim: true, hints: true }),
      'repeat rules': (text) => findRepeatRuleProblems(text.split('\n')),
      'unlinked mentions': (text) => {
        const other = parseMarkdown('notes/atlas plan.md', '# Atlas Plan');
        const file = parseMarkdown('notes/atlas.md', text);
        const index = buildWorkspaceIndex(new Map([[other.filePath, other], [file.filePath, file]]));
        return findUnlinkedMentions(other, index);
      },
    };
    const dashes = parseMarkdown('notes/atlas.md', note('---'));
    assert.deepStrictEqual(dashes.aliases, ['Atlas Plan'], 'the dashed note has front matter to agree on');
    Object.entries(readers).forEach(([name, read]) => {
      assert.deepStrictEqual(read(note('...')), read(note('---')), name);
    });
  });

  test('values are split, trimmed, and unquoted', () => {
    assert.deepStrictEqual(splitFrontmatterValues(' [a, "b", , \'c\'] '), ['a', 'b', 'c']);
    assert.deepStrictEqual(splitFrontmatterValues(' "solo" '), ['solo']);
    assert.deepStrictEqual(splitFrontmatterValues('   '), []);
    assert.deepStrictEqual(splitFrontmatterValues('[]', { keepEmptyValue: true }), []);
  });

  test('an empty quoted value is kept only when asked', () => {
    assert.deepStrictEqual(splitFrontmatterValues('""'), []);
    assert.deepStrictEqual(splitFrontmatterValues("''", { keepEmptyValue: true }), ['']);
  });

  test('unquote takes one quote off each end', () => {
    assert.strictEqual(unquote('"a"'), 'a');
    assert.strictEqual(unquote('\'a"'), 'a');
    assert.strictEqual(unquote('""a""'), '"a"');
    assert.strictEqual(unquote('a'), 'a');
  });
});

suite('Rename Tag in front matter', () => {
  const rename = (content: string, source: string, key: string) =>
    replaceIndexedTag(content, source, { key, label: key }).content;

  test('quotes a new tag YAML would misread in a field written plain', () => {
    assert.strictEqual(
      rename('---\nproject: atlas\n---\n# H\n', '#project/atlas', '#topic/atlas'),
      '---\nproject: "#topic/atlas"\n---\n# H\n',
    );
    assert.strictEqual(
      rename('---\npeople: [dana]\n---\n# H\n', '@dana', '#team/dana'),
      '---\npeople: ["#team/dana"]\n---\n# H\n',
    );
    assert.strictEqual(rename('---\ntags: [atlas, b]\n---\n', '#atlas', '@dana'), '---\ntags: ["@dana", b]\n---\n');
  });

  test('writes a tag plain where YAML reads it plain, and keeps quotes already there', () => {
    assert.strictEqual(rename('---\nproject: atlas\n---\n', '#project/atlas', '#project/hermes'), '---\nproject: hermes\n---\n');
    assert.strictEqual(
      rename('---\nproject: "atlas"\n---\n', '#project/atlas', '#topic/atlas'),
      '---\nproject: "#topic/atlas"\n---\n',
    );
    assert.strictEqual(rename('---\ntags: [old, #old]\n---\n', '#old', '#new'), '---\ntags: [new, #new]\n---\n', 'a value written with its # keeps its shape');
  });

  test('reads a field written with a space before its colon, as YAML and the parser do', () => {
    assert.strictEqual(rename('---\ntags : [atlas]\n---\n# H\n', '#atlas', '#beta'), '---\ntags : [beta]\n---\n# H\n');
    assert.strictEqual(
      rename('---\nproject\t: atlas\n---\n', '#project/atlas', '#project/hermes'),
      '---\nproject\t: hermes\n---\n',
    );
    assert.strictEqual(rename('---\ntags : [atlas, beta]\n---\n', '#atlas', '#beta'), '---\ntags : [beta]\n---\n', 'a merge in one list leaves one');
  });
});
