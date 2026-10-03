import * as assert from 'assert';

import { parseQuery } from '../domain/query/queryParser';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { formatQuery, fromBuilderTree, toBuilderTree } from '../domain/query/queryFormat';
import {
  computeParked,
  mentionsParked,
  NO_PARKED_RULES,
  parkedLast,
  withoutParked,
} from '../domain/index/parked';
import { indexWithParking, parkedRules } from './parkedFixture';
import { createQueryContext } from '../domain/query/queryContext';
import { WorkspaceIndex } from '../domain/model';
import { createQuerySuggestions } from '../ui/state/querySuggestions';

/** A task title without its tags. */
function bare(title: string): string {
  return title.replace(/\s+[#@][^\s]+/g, '').trim();
}

function taskTitles(index: WorkspaceIndex, ids: Iterable<string>): string[] {
  return [...ids].map((id) => bare(index.tasks.get(id)?.title ?? id)).sort();
}

function headings(index: WorkspaceIndex, ids: Iterable<string>): string[] {
  return [...ids].map((id) => bare(index.sections.get(id)?.heading ?? id)).sort();
}

suite('Parked notes', () => {
  test('a parked folder parks every entry, task, and front-matter-only note in it', () => {
    const index = indexWithParking(
      {
        'archive/old.md': '# Old plan #project/atlas\n- [ ] Old task\n',
        'archive/tags-only.md': '---\ntags: [area/home]\n---\nJust words.\n',
        'notes/live.md': '# Live #project/atlas\n- [ ] Live task\n',
      },
      { folders: ['archive'] },
    );
    const parked = index.parked!;
    assert.deepStrictEqual([...parked.files].sort(), ['archive/old.md', 'archive/tags-only.md']);
    assert.deepStrictEqual(taskTitles(index, parked.tasks), ['Old task']);
    assert.deepStrictEqual(headings(index, parked.sections), ['Old plan']);
    assert.strictEqual(parked.byFolder, 2);
    assert.strictEqual(parked.byTag, 0);
    assert.ok(parked.tags.has('#area/home'), 'a tag used only in parked notes is parked-only');
    assert.ok(!parked.tags.has('#project/atlas'), 'a tag also used elsewhere is not');
  });

  test('a front-matter tag parks the whole note', () => {
    const index = indexWithParking({
      'a.md': '---\ntags: [parked]\n---\n# One\n- [ ] Task one\n## Two\n- [ ] Task two\n',
      'b.md': '# Other\n- [ ] Kept\n',
    });
    const parked = index.parked!;
    assert.deepStrictEqual([...parked.files], ['a.md']);
    assert.deepStrictEqual([...parked.taggedFiles], ['a.md']);
    assert.deepStrictEqual(taskTitles(index, parked.tasks), ['Task one', 'Task two']);
    assert.strictEqual(parked.byTag, 1);
  });

  test('a heading tag parks the heading, the headings under it, and their tasks, not its siblings', () => {
    const index = indexWithParking({
      'plan.md': [
        '# Plan',
        '## Old #parked',
        '- [ ] Old task',
        '### Older',
        '- [ ] Older task',
        '## Current',
        '- [ ] Current task',
        '',
      ].join('\n'),
    });
    const parked = index.parked!;
    assert.deepStrictEqual(headings(index, parked.sections), ['Old', 'Older']);
    assert.deepStrictEqual(taskTitles(index, parked.tasks), ['Old task', 'Older task']);
    assert.strictEqual(parked.files.size, 0);
  });

  test('a tag on a task parks only that task', () => {
    const index = indexWithParking({
      'a.md': '# List\n- [ ] Someday idea #parked\n- [ ] Real work\n',
    });
    assert.deepStrictEqual(taskTitles(index, index.parked!.tasks), ['Someday idea']);
  });

  test('a parked tag parks its sub-tags, however it is written, and not a longer name', () => {
    const index = indexWithParking(
      {
        'a.md': '# A\n- [ ] Phase #project/old/phase-1\n- [ ] Near miss #project/older\n- [ ] Plain #project/old\n',
      },
      { tags: ['#Project/Old'] },
    );
    assert.deepStrictEqual(taskTitles(index, index.parked!.tasks), ['Phase', 'Plain']);
  });

  test('#Parked, parked, and #parked are one parked tag', () => {
    ['#Parked', 'parked', '#parked', ' PARKED '].forEach((written) => {
      const index = indexWithParking({ 'a.md': '# A\n- [ ] One #Parked\n' }, { tags: [written] });
      assert.strictEqual(index.parked!.tasks.size, 1, written);
    });
  });

  test('a person can be parked', () => {
    const index = indexWithParking(
      { 'a.md': '# A\n- [ ] Ask @ren\n- [ ] Ask @dana\n' },
      { tags: ['@ren'] },
    );
    assert.deepStrictEqual(
      [...index.parked!.tasks].map((id) => index.tasks.get(id)?.title),
      ['Ask @ren'],
    );
    assert.ok(index.parked!.tags.has('@ren'));
  });

  test('nothing to park costs nothing and parks nothing', () => {
    const index = indexWithParking({ 'a.md': '# A #project/x\n- [ ] One\n' });
    const empty = computeParked(index, NO_PARKED_RULES);
    assert.strictEqual(empty.sections.size + empty.tasks.size + empty.files.size + empty.tags.size, 0);
    const unused = computeParked(index, parkedRules());
    assert.strictEqual(unused.tasks.size, 0);
  });

  test('parks exactly what a search for the parked tag finds', () => {
    const index = indexWithParking({
      'a.md': '---\ntags: [parked]\n---\n# A\n- [ ] One\n',
      'b.md': '# B\n## Old #parked/2025\n- [ ] Two\nA line #parked here.\n### Deeper\n- [ ] Three\n## New\n- [ ] Four\n',
      'c.md': '# C\n- [ ] Five #parked\n',
    });
    const found = evaluateQuery(index, parseQuery('tag = #parked OR tag = #parked/*').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(
      found.sections.map((section) => section.id).sort(),
      [...index.parked!.sections].sort(),
    );
    assert.deepStrictEqual(found.tasks.map((task) => task.id).sort(), [...index.parked!.tasks].sort());
  });

  test('is:parked finds parked notes and tasks, and -is:parked the rest', () => {
    const index = indexWithParking(
      {
        'archive/a.md': '# Archived\n- [ ] Old\n',
        'b.md': '# Live\n- [ ] New\n- [ ] Idea #parked\n',
      },
      { folders: ['archive'] },
    );
    const parked = evaluateQuery(index, parseQuery('is:parked').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(parked.sections.map((section) => bare(section.heading)), ['Archived']);
    assert.deepStrictEqual(parked.tasks.map((task) => bare(task.title)).sort(), ['Idea', 'Old']);
    const rest = evaluateQuery(index, parseQuery('is:task -is:parked').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(rest.tasks.map((task) => bare(task.title)), ['New']);
    const available = evaluateQuery(index, parseQuery('is:available').node, createQueryContext(Date.now()));
    assert.deepStrictEqual(available.tasks.map((task) => bare(task.title)), ['New']);
  });

  test('is:parked matches nothing in an index nothing parks', () => {
    const index = indexWithParking({ 'a.md': '# A\n- [ ] One\n' });
    delete index.parked;
    assert.strictEqual(evaluateQuery(index, parseQuery('is:parked').node, createQueryContext(Date.now())).tasks.length, 0);
  });

  test('the is: diagnostic lists parked', () => {
    const parsed = parseQuery('is:archived');
    assert.match(parsed.diagnostics[0].message, /periodic, parked, or step — not "archived"/);
    assert.strictEqual(parseQuery('is:parked').diagnostics.length, 0);
  });

  test('mentionsParked finds is:parked for or against, at any depth', () => {
    assert.ok(mentionsParked(parseQuery('is:parked').node));
    assert.ok(mentionsParked(parseQuery('-is:parked').node));
    assert.ok(mentionsParked(parseQuery('is:open (#a OR NOT is:parked)').node));
    assert.ok(!mentionsParked(parseQuery('is:open #parked').node));
    assert.ok(!mentionsParked(undefined));
  });

  test('withoutParked and parkedLast keep order', () => {
    const index = indexWithParking({ 'a.md': '# A\n- [ ] One\n- [ ] Two #parked\n- [ ] Three\n' });
    const tasks = [...index.tasks.values()];
    assert.deepStrictEqual(withoutParked(tasks, index).map((task) => bare(task.title)), ['One', 'Three']);
    assert.deepStrictEqual(
      parkedLast(tasks, (task) => index.parked!.tasks.has(task.id)).map((task) => bare(task.title)),
      ['One', 'Three', 'Two'],
    );
  });

  test('the builder offers is:parked and writes it back as typed', () => {
    const index = indexWithParking({ 'a.md': '# A\n' });
    const offered = (createQuerySuggestions(index, [], createQueryContext(Date.now())).values.is ?? []).map((item) => item.value);
    assert.ok(offered.includes('parked'));
    ['is:parked', 'is:open -is:parked'].forEach((query) => {
      const text = fromBuilderTree(toBuilderTree(parseQuery(query).node));
      assert.strictEqual(formatQuery(parseQuery(text).node), formatQuery(parseQuery(query).node), query);
    });
  });
});
