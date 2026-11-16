import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { findBreadcrumbs, findHubTagKey, getHubGraph, namespaceLabel, readUpTargets } from '../ui/state/hubTree';
import { WorkspaceIndex } from '../domain/model';
import { computeParked } from '../domain/index/parked';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

suite('Notes under their hubs', () => {
  const index = indexOf({
    'hubs/Atlas.md': '---\ndescribes: project/atlas\n---\n# Atlas\n- [x] Pick a vendor\n- [ ] Send the proposal',
    'hubs/Ledger.md': '---\ndescribes: project/ledger\nup: "[[Atlas]]"\n---\n# Ledger migration',
    'hubs/Borealis.md': '---\ndescribes: project/borealis\n---\n# Borealis',
    'hubs/Dana.md': '---\ndescribes: "@dana"\n---\n# Dana Reyes',
    'notes/vendor.md': '# Vendor review #project/atlas\nNotes.',
    'notes/kickoff.md': '---\nprojects: [atlas, borealis]\n---\n# Kickoff',
    'notes/daily.md': '# 2026-10-03\n- Talked about #project/atlas in passing',
    'notes/cutover.md': '---\ntags: [project/atlas]\nup: Ledger\n---\n# Cutover plan',
    'notes/one-on-one.md': '# One-on-one @dana',
    'notes/child.md': '---\nup: "[[Plain]]"\n---\n# Child',
    'notes/Plain.md': '# Plain',
  });

  test('each hub note is known by its tag, and each note by the hubs of the tags it is about', () => {
    const graph = getHubGraph(index);
    assert.deepStrictEqual([...graph.hubTags].sort(), [
      ['hubs/Atlas.md', '#project/atlas'],
      ['hubs/Borealis.md', '#project/borealis'],
      ['hubs/Dana.md', '@dana'],
      ['hubs/Ledger.md', '#project/ledger'],
    ]);
    assert.deepStrictEqual(graph.parents.get('notes/vendor.md'), ['hubs/Atlas.md']);
    assert.deepStrictEqual(graph.parents.get('notes/kickoff.md'), ['hubs/Atlas.md', 'hubs/Borealis.md']);
    assert.deepStrictEqual(graph.parents.get('notes/cutover.md'), ['hubs/Ledger.md'], 'up: places a note there alone');
    assert.deepStrictEqual(graph.parents.get('hubs/Ledger.md'), ['hubs/Atlas.md']);
  });

  test('a line that mentions a tag in passing does not file its note there', () => {
    assert.strictEqual(getHubGraph(index).parents.get('notes/daily.md'), undefined);
  });

  test('breadcrumbs run from the namespace down to the note, by up: first', () => {
    assert.deepStrictEqual(findBreadcrumbs(index, 'notes/cutover.md'), [
      {
        labels: ['Projects', 'Atlas', 'Ledger migration', 'Cutover plan'],
        parent: 'hubs/Ledger.md',
        notes: ['hubs/Atlas.md', 'hubs/Ledger.md', 'notes/cutover.md'],
      },
    ]);
    assert.deepStrictEqual(
      findBreadcrumbs(index, 'notes/kickoff.md').map((crumbs) => crumbs.labels.join(' › ')).sort(),
      ['Projects › Atlas › Kickoff', 'Projects › Borealis › Kickoff'],
    );
    assert.deepStrictEqual(findBreadcrumbs(index, 'hubs/Atlas.md'), [], 'a hub at the top has none');
    assert.deepStrictEqual(findBreadcrumbs(index, 'notes/child.md'), [
      { labels: ['Plain', 'Child'], parent: 'notes/Plain.md', notes: ['notes/Plain.md', 'notes/child.md'] },
    ]);
  });

  test('reads up: as a link, a name, or a list', () => {
    assert.deepStrictEqual(readUpTargets('---\nup: "[[Atlas]]"\n---'), ['Atlas']);
    assert.deepStrictEqual(readUpTargets('---\nup: Atlas\n---'), ['Atlas']);
    assert.deepStrictEqual(readUpTargets('---\nUp: ["[[A]]", "[[B|bee]]"]\n---'), ['A', 'B']);
    assert.deepStrictEqual(readUpTargets('---\nup:\n  - "[[A]]"\n  - B\ntags: x\n---'), ['A', 'B']);
    assert.deepStrictEqual(readUpTargets('# No front matter\nup: [[A]]'), []);
  });

  test('a namespace’s heading is its words made plural', () => {
    assert.deepStrictEqual(['project', 'person', 'company', 'status', 'follow-up'].map(namespaceLabel), ['Projects', 'People', 'Companies', 'Statuses', 'Follow Ups']);
  });

  test('a hub’s own property tags describe it rather than file it', () => {
    const teams = indexOf({
      'Harbor.md': '---\ndescribes: team/harbor\nregulars: ["#person/sable-ortiz"]\n---\n# Harbor',
      'Sable.md': '---\ndescribes: person/sable-ortiz\nteam: "#team/harbor"\n---\n# Sable Ortiz',
    });
    assert.deepStrictEqual([...getHubGraph(teams).parents], []);
  });

  test('a cycle of up: stops rather than running away', () => {
    const looped = indexOf({
      'a.md': '---\ndescribes: project/a\nup: "[[b]]"\n---\n# A',
      'b.md': '---\nup: "[[a]]"\n---\n# B',
    });
    assert.deepStrictEqual([...getHubGraph(looped).hubTags], [['a.md', '#project/a']], 'the hub in the loop is still a hub');
    assert.ok(findBreadcrumbs(looped, 'b.md').length <= 3);
  });

  test('reads an up: list written without indent, or with a comment in it', () => {
    assert.deepStrictEqual(readUpTargets('---\nup:\n- "[[A]]"\n- B\n---'), ['A', 'B']);
    assert.deepStrictEqual(readUpTargets('---\nup:\n  # the parent\n  - "[[A]]"\n\n  - B\ntags: x\n---'), ['A', 'B']);
  });

  test('leaves parked notes out', () => {
    const files = new Map([
      ['H.md', parseMarkdown('H.md', '---\ndescribes: project/h\n---\n# H\n- [ ] Live task')],
      ['Old.md', parseMarkdown('Old.md', '---\ntags: [parked, project/h]\n---\n# Old parked note\n- [ ] Parked task')],
      ['P.md', parseMarkdown('P.md', '---\ndescribes: project/p\ntags: [parked]\n---\n# Parked hub')],
    ]);
    const parkedIndex = buildWorkspaceIndex(files);
    parkedIndex.parked = computeParked(parkedIndex, { isParkedPath: () => false, hasFolders: false, tags: ['#parked'] });
    const graph = getHubGraph(parkedIndex);
    assert.deepStrictEqual([...graph.hubTags], [['H.md', '#project/h']]);
    assert.deepStrictEqual([...graph.parents], [], 'a parked note is filed under nothing');
  });

  test('does not pluralize a namespace that is plural', () => {
    assert.deepStrictEqual(['projects', 'areas', 'people', 'status', 'focus'].map(namespaceLabel), ['Projects', 'Areas', 'People', 'Statuses', 'Focuses']);
  });

  test('finds the tag a note is the hub of, and none for a note another hub has taken or a plain note', () => {
    const index = indexOf({
      'Atlas.md': '---\ndescribes: project/atlas\n---\n# Atlas',
      'Atlas copy.md': '---\ndescribes: project/atlas\n---\n# Atlas copy',
      'Both.md': '---\ndescribes: [project/atlas, project/relay]\n---\n# Both',
      'Plain.md': '# Plain #project/atlas',
    });
    const hub = index.tags.get('#project/atlas')?.hubFilePaths?.[0];
    assert.ok(hub);
    assert.strictEqual(findHubTagKey(index, hub), '#project/atlas');
    assert.strictEqual(findHubTagKey(index, 'Both.md'), hub === 'Both.md' ? '#project/atlas' : '#project/relay', 'the first tag whose hub it is');
    const taken = ['Atlas.md', 'Atlas copy.md'].find((filePath) => filePath !== hub);
    assert.strictEqual(findHubTagKey(index, taken!), undefined, 'another note is that tag’s hub');
    assert.strictEqual(findHubTagKey(index, 'Plain.md'), undefined);
  });
});
