import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { linkWords, toPlainMarkdown } from '../ui/state/plainMarkdown';
import { WorkspaceIndex } from '../domain/model';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

suite('Copy as Plain Markdown', () => {
  const index = indexOf({
    'notes/Atlas.md': '# Atlas #project/atlas\n\n## Decision\nWe chose the ledger. ^choice\n- [ ] Send the proposal 📅 2026-10-09\n- [x] Pick a vendor',
    'notes/Deep.md': '# Deep\n![[Deeper]]',
    'notes/Deeper.md': '# Deeper\n![[Deepest]]',
    'notes/Deepest.md': '# Deepest\n![[Atlas#Decision]]',
  });
  const context = { index, queryContext: createQueryContext(new Date(2026, 9, 3).getTime()) };

  test('writes links as their words, front matter and markers left out', () => {
    const note = '---\ntags: [x]\n---\n# Plan\nSee [[Atlas]], [[Atlas#Decision|the decision]], and [[Atlas#Decision]]. ^mine\nAn inline ![[Atlas]] too.\nCode `[[Atlas]]` stays.';
    assert.strictEqual(
      toPlainMarkdown(note, context),
      '# Plan\nSee Atlas, the decision, and Atlas › Decision.\nAn inline Atlas too.\nCode `[[Atlas]]` stays.\n',
    );
    assert.strictEqual(linkWords('#^choice'), 'choice');
    assert.strictEqual(linkWords('#Heading'), 'Heading');
  });

  test('writes an embed as the text it names, three deep, and a broken one as its words', () => {
    assert.strictEqual(
      toPlainMarkdown('# Notes\n![[Atlas#Decision]]\n![[Missing]]', context),
      '# Notes\n## Decision\nWe chose the ledger.\n- [ ] Send the proposal 📅 2026-10-09\n- [x] Pick a vendor\nMissing\n',
    );
    const deep = toPlainMarkdown('![[Deep]]', context);
    assert.ok(deep.includes('# Deep\n# Deeper\n# Deepest\nAtlas › Decision'), deep);
  });

  test('writes a query block as its results as they stand, a list or a table', () => {
    const list = toPlainMarkdown('Open:\n```deckard\n#project/atlas is:task\n```\nEnd', context);
    assert.strictEqual(list, 'Open:\n- [ ] Send the proposal (due 2026-10-09)\n- [x] Pick a vendor\nEnd\n');
    const table = toPlainMarkdown('```deckard view=table columns=due noteColumns=tasks\n#project/atlas\n```', context);
    assert.ok(table.includes('| Entry | Tasks |\n| --- | --- |\n| Atlas | 1 of 2 done |'), table);
    assert.ok(table.includes('| Task | Due |\n| --- | --- |\n| ☐ Send the proposal |'), table);
    assert.strictEqual(toPlainMarkdown('```deckard\n(broken\n```', context), '`(broken`\n');
    assert.strictEqual(toPlainMarkdown('```js\n[[Atlas]] ![[x]]\n```', context), '```js\n[[Atlas]] ![[x]]\n```\n', 'other code is left as written');
  });
});
