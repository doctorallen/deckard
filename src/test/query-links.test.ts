import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { evaluateQuery } from '../core/query/queryEvaluator';
import { formatQuery } from '../core/query/queryFormat';
import { parseQuery } from '../core/query/queryParser';
import { QueryConditionNode } from '../core/query/queryTypes';
import { WorkspaceIndex } from '../core/types';
import { getBacklinkIndex } from '../core/workspace/backlinks';
import { buildWorkspaceIndex } from '../core/workspace/indexer';

function condition(text: string): QueryConditionNode {
  const parsed = parseQuery(text);
  assert.deepStrictEqual(parsed.diagnostics, [], text);
  assert.strictEqual(parsed.node?.type, 'condition', text);
  return parsed.node as QueryConditionNode;
}

function errorOf(text: string): string {
  return parseQuery(text).diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ?? '';
}

function createIndex(): WorkspaceIndex {
  const files = new Map(
    Object.entries({
      'notes/Atlas plan.md': '---\naliases: [Atlas]\n---\n# Atlas plan\nSee [[Atlas plan]] and [[#Decision]] above.\n## Decision\nWe chose.\n',
      'notes/Standup.md':
        '# Standup\n## Decisions\nWe moved [[Atlas plan]] to Q4.\n### Risks\nVendor risk.\n- [ ] Call Ren about [[Atlas#Decision]]\n',
      'notes/Headless.md': 'A note with no heading links [[Atlas plan|the plan]].\n',
      'notes/Front.md': '---\nlinks: "[[Atlas plan]]"\n---\n# Front\nNothing here.\n',
      'notes/Fenced.md': '# Fenced\n```\n[[Atlas plan]]\n```\n',
      'notes/Future.md': '# Future\nPlan the [[Q4 offsite]] soon.\n',
      'notes/Tagged.md': '# Tagged\n- A line about [[Atlas plan]] #project/atlas\n',
    }).map(([path, content]) => [path, parseMarkdown(path, content)]),
  );
  return buildWorkspaceIndex(files);
}

function found(index: WorkspaceIndex, query: string): string[] {
  const parsed = parseQuery(query);
  assert.deepStrictEqual(parsed.diagnostics, [], query);
  const results = evaluateQuery(index, parsed.node);
  return [
    ...results.sections.map((section) => `${section.filePath}:${section.heading}`),
    ...results.tasks.map((task) => `task ${task.filePath}:${task.lineNumber}`),
    ...results.files.map((file) => `file ${file.filePath}`),
  ].sort();
}

suite('Searching by link', () => {
  test('reads [[Atlas]] and link = … as one link condition', () => {
    assert.deepStrictEqual(
      [condition('[[Atlas]]').field, condition('[[Atlas]]').operator, condition('[[Atlas]]').value],
      ['link', 'eq', 'Atlas'],
    );
    assert.strictEqual(condition('[[Atlas plan]]').value, 'Atlas plan');
    assert.strictEqual(condition('[[Atlas|the plan]]').value, 'Atlas');
    assert.strictEqual(condition('link:[[Atlas]]').value, 'Atlas');
    assert.strictEqual(condition('link = Atlas').value, 'Atlas');
    assert.strictEqual(condition('link = "Atlas plan"').value, 'Atlas plan');
    assert.strictEqual(condition('links = [[Atlas#Decision]]').value, 'Atlas#Decision');
    assert.strictEqual(condition('[[Atlas#^q3]]').value, 'Atlas#^q3');
    assert.strictEqual(condition('link != [[Atlas]]').operator, 'neq');
    const negated = parseQuery('-[[Atlas]]').node;
    assert.strictEqual(negated?.type, 'not');
  });

  test('says what is wrong with a link it cannot read', () => {
    assert.strictEqual(errorOf('[[Atl'), 'This link is missing its closing ]].');
    assert.strictEqual(
      errorOf('[[#Decision]]'),
      "link needs a note's name, such as [[Atlas]] or [[Atlas#Decision]].",
    );
    assert.strictEqual(errorOf('[[]]'), "link needs a note's name, such as [[Atlas]] or [[Atlas#Decision]].");
    assert.match(errorOf('link > Atlas'), /^link does not support ">"\. Try: =, !=\.$/);
  });

  test('writes a link back the way it reads, and keeps [[ in text as characters', () => {
    for (const [written, canonical] of [
      ['[[Atlas plan]]', 'link = [[Atlas plan]]'],
      ['-[[Atlas]]', 'NOT link = [[Atlas]]'],
      ['link != [[Atlas#Decision]]', 'link != [[Atlas#Decision]]'],
      ['[[Atlas]] #project/atlas', 'link = [[Atlas]] AND tag = #project/atlas'],
    ]) {
      const formatted = formatQuery(parseQuery(written).node);
      assert.strictEqual(formatted, canonical);
      assert.strictEqual(formatQuery(parseQuery(formatted).node), canonical);
    }
    const text = parseQuery('text ~ [[x]]').node as QueryConditionNode;
    assert.deepStrictEqual([text.field, text.value], ['text', '[[x]]']);
    const formatted = formatQuery(text);
    assert.strictEqual(formatted, 'text ~ "[[x]]"');
    assert.strictEqual((parseQuery(formatted).node as QueryConditionNode).field, 'text');
  });

  test('finds the entries whose own lines link to the note, and no more', () => {
    const index = createIndex();
    // A link to one of Atlas plan's headings is a link to it; a line that
    // is an entry of its own answers alone, not with its heading too.
    assert.deepStrictEqual(found(index, '[[Atlas plan]]'), [
      'file notes/Front.md',
      'file notes/Headless.md',
      'notes/Standup.md:Decisions',
      'notes/Tagged.md:- A line about [[Atlas plan]] #project/atlas',
      'task notes/Standup.md:6',
    ]);
    // An alias names the same note; a link in a code fence never counts,
    // and a note linking itself is not a link to it.
    assert.deepStrictEqual(found(index, '[[Atlas]]'), found(index, '[[Atlas plan]]'));
  });

  test('narrows to a heading, including a link from inside the note', () => {
    const index = createIndex();
    assert.deepStrictEqual(found(index, '[[Atlas plan#Decision]]'), [
      // `[[#Decision]]` reads as a tagged line of its own.
      'notes/Atlas plan.md:See [[Atlas plan]] and [[#Decision]] above.',
      'task notes/Standup.md:6',
    ]);
  });

  test('finds the links to a note not written yet', () => {
    assert.deepStrictEqual(found(createIndex(), '[[Q4 offsite]]'), ['notes/Future.md:Future']);
  });

  test('leaves the notes of other searches as they were', () => {
    const index = createIndex();
    assert.deepStrictEqual(found(index, 'text ~ plan').filter((entry) => entry.startsWith('file ')), []);
    assert.ok(!found(index, '-[[Atlas plan]]').includes('file notes/Headless.md'));
  });

  test('agrees with Linked from on every linking line', () => {
    const index = createIndex();
    const backlinks = getBacklinkIndex(index);
    index.files.forEach((file) => {
      const title = file.filePath.split('/').pop()!.replace(/\.md$/, '');
      const expected = new Set(
        backlinks.toNote(file.filePath).map((link) => `${link.sourcePath}:${link.line + 1}`),
      );
      const results = evaluateQuery(index, parseQuery(`link = [[${title}]]`).node);
      const covered = new Set<string>();
      expected.forEach((line) => {
        const [path, number] = [line.slice(0, line.lastIndexOf(':')), Number(line.slice(line.lastIndexOf(':') + 1))];
        const answered =
          results.tasks.some((task) => task.filePath === path && task.lineNumber === number) ||
          results.sections.some(
            (section) =>
              section.filePath === path &&
              section.startLine <= number &&
              (section.isInline ? section.endLine : section.bodyEndLine) >= number,
          ) ||
          results.files.some((candidate) => candidate.filePath === path);
        if (answered) {
          covered.add(line);
        }
      });
      assert.deepStrictEqual([...covered].sort(), [...expected].sort(), title);
    });
  });
});
