import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { buildHubTree, findBreadcrumbs, findHubTagKey, HubTreeNode, namespaceLabel, readUpTargets } from '../ui/state/hubTree';
import { WorkspaceIndex } from '../domain/model';
import { computeParked } from '../domain/index/parked';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

/** The tree as indented labels, descriptions after a colon. */
function outline(nodes: readonly HubTreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.label}${node.description ? `: ${node.description}` : ''}`,
    ...outline(node.children, depth + 1),
  ]);
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

  test('lists each namespace’s hubs, and under each the notes about its tag', () => {
    assert.deepStrictEqual(outline(buildHubTree(index, Date.now())), [
      'People',
      '  Dana Reyes',
      '    One-on-one',
      'Projects',
      '  Atlas: 1 of 2 done',
      '    Kickoff',
      '    Ledger migration',
      '      Cutover plan',
      '    Vendor review',
      '  Borealis',
      '    Kickoff',
      'Other notes',
      '  Plain',
      '    Child',
    ]);
  });

  test('a line that mentions a tag in passing does not file its note there', () => {
    const labels = outline(buildHubTree(index, Date.now())).map((line) => line.trim());
    assert.ok(!labels.includes('2026-10-03'));
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
    assert.deepStrictEqual(outline(buildHubTree(teams, Date.now())), ['People', '  Sable Ortiz', 'Teams', '  Harbor']);
  });

  test('a cycle of up: stops rather than running away', () => {
    const looped = indexOf({
      'a.md': '---\ndescribes: project/a\nup: "[[b]]"\n---\n# A',
      'b.md': '---\nup: "[[a]]"\n---\n# B',
    });
    assert.ok(outline(buildHubTree(looped, Date.now())).some((line) => line.trim() === 'A'), 'the hub in the loop is still listed');
    assert.ok(findBreadcrumbs(looped, 'b.md').length <= 3);
  });

  test('reads an up: list written without indent, or with a comment in it', () => {
    assert.deepStrictEqual(readUpTargets('---\nup:\n- "[[A]]"\n- B\n---'), ['A', 'B']);
    assert.deepStrictEqual(readUpTargets('---\nup:\n  # the parent\n  - "[[A]]"\n\n  - B\ntags: x\n---'), ['A', 'B']);
  });

  test('leaves parked notes out, and their tasks out of a hub’s count', () => {
    const files = new Map([
      ['H.md', parseMarkdown('H.md', '---\ndescribes: project/h\n---\n# H\n- [ ] Live task')],
      ['Old.md', parseMarkdown('Old.md', '---\ntags: [parked, project/h]\n---\n# Old parked note\n- [ ] Parked task')],
      ['P.md', parseMarkdown('P.md', '---\ndescribes: project/p\ntags: [parked]\n---\n# Parked hub')],
    ]);
    const parkedIndex = buildWorkspaceIndex(files);
    parkedIndex.parked = computeParked(parkedIndex, { isParkedPath: () => false, hasFolders: false, tags: ['#parked'] });
    assert.deepStrictEqual(outline(buildHubTree(parkedIndex, Date.now())), ['Projects', '  H: 0 of 1 done']);
  });

  test('gives every group an id no namespace can take, and does not pluralize what is plural', () => {
    const odd = indexOf({
      'L.md': '---\ndescribes: loose/x\n---\n# L',
      'O.md': '---\ndescribes: other/y\n---\n# O',
      'T.md': '---\ndescribes: follow-up\n---\n# T',
      'child.md': '---\nup: "[[Plain]]"\n---\n# Child',
      'Plain.md': '# Plain',
    });
    const tree = buildHubTree(odd, Date.now());
    assert.deepStrictEqual(tree.map((group) => [group.id, group.label]), [
      ['namespace:loose', 'Looses'],
      ['namespace:other', 'Others'],
      ['group:other-tags', 'Other tags'],
      ['group:other-notes', 'Other notes'],
    ]);
    assert.deepStrictEqual(['projects', 'areas', 'people', 'status', 'focus'].map(namespaceLabel), ['Projects', 'Areas', 'People', 'Statuses', 'Focuses']);
  });

  test('lists a note no top reaches, in a loop or below a chain too deep to draw, rather than losing it', () => {
    const loop = indexOf({
      'N1.md': '---\nup: "[[N2]]"\n---\n# N1',
      'N2.md': '---\nup: "[[N1]]"\n---\n# N2',
    });
    const labels = outline(buildHubTree(loop, Date.now())).map((line) => line.trim());
    assert.ok(labels.includes('N1') && labels.includes('N2'), labels.join(' | '));
    const chain: Record<string, string> = { 'R.md': '---\ndescribes: project/r\n---\n# R' };
    for (let n = 1; n <= 12; n += 1) {
      chain[`C${n}.md`] = `---\nup: "[[${n === 1 ? 'R' : `C${n - 1}`}]]"\n---\n# C${n}`;
    }
    const deep = outline(buildHubTree(indexOf(chain), Date.now())).map((line) => line.trim());
    assert.ok(deep.includes('C12'), 'the bottom of the chain is listed somewhere');
  });

  test('builds a hub with many notes quickly', () => {
    const many: Record<string, string> = { 'H.md': '---\ndescribes: project/h\n---\n# H' };
    for (let n = 0; n < 3000; n += 1) {
      many[`n/${n}.md`] = `# Note ${n} #project/h`;
    }
    const big = indexOf(many);
    const started = Date.now();
    const tree = buildHubTree(big, Date.now());
    assert.strictEqual(tree[0].children[0].children.length, 3000);
    assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
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
