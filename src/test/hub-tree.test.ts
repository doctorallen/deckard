import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { buildHubTree, findBreadcrumbs, HubTreeNode, namespaceLabel, readUpTargets } from '../ui/state/hubTree';
import { WorkspaceIndex } from '../domain/model';

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
});
