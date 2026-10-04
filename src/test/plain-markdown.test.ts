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
      '# Notes\n\n## Decision\nWe chose the ledger.\n- [ ] Send the proposal 📅 2026-10-09\n- [x] Pick a vendor\n\nMissing\n',
    );
    const deep = toPlainMarkdown('![[Deep]]', context);
    assert.ok(deep.includes('# Deep\n\n# Deeper\n\n# Deepest\n\nAtlas › Decision'), deep);
  });

  test('writes a query block as its results as they stand, a list or a table', () => {
    const list = toPlainMarkdown('Open:\n```deckard\n#project/atlas is:task\n```\nEnd', context);
    assert.strictEqual(list, 'Open:\n\n- [ ] Send the proposal (due 2026-10-09)\n- [x] Pick a vendor\n\nEnd\n');
    const table = toPlainMarkdown('```deckard view=table columns=due noteColumns=tasks\n#project/atlas\n```', context);
    assert.ok(table.includes('| Entry | Tasks |\n| --- | --- |\n| Atlas | 1 of 2 done |'), table);
    assert.ok(table.includes('| Task | Due |\n| --- | --- |\n| ☐ Send the proposal |'), table);
    assert.strictEqual(toPlainMarkdown('```deckard\n(broken\n```', context), '`(broken`\n');
    assert.strictEqual(toPlainMarkdown('```js\n[[Atlas]] ![[x]]\n```', context), '```js\n[[Atlas]] ![[x]]\n```\n', 'other code is left as written');
  });

  test('escapes a table cell’s backslashes and pipes, so the cell stays one cell', () => {
    const odd = indexOf({ 'notes/Odd.md': '# Odd #odd\n- [ ] Path C:\\temp\\ | or a|b #odd' });
    const table = toPlainMarkdown('```deckard view=table columns=title\n#odd is:task\n```', { ...context, index: odd });
    assert.ok(table.includes('| ☐ Path C:\\\\temp\\\\ \\| or a\\|b |'), table);
  });

  test('keeps a blank line around what it writes in, so the next line stays its own', () => {
    const out = toPlainMarkdown('Open:\n```deckard\n#project/atlas is:task is:open\n```\nThanks.', context);
    assert.strictEqual(out, 'Open:\n\n- [ ] Send the proposal (due 2026-10-09)\n\nThanks.\n');
  });

  test('treats a selection that starts with a rule as text, and leaves code’s blank lines alone', () => {
    assert.strictEqual(toPlainMarkdown('---\nA paragraph.\n\n---\nMore', context, '# Note\n\n---\nA paragraph.\n\n---\nMore'), '---\nA paragraph.\n\n---\nMore\n');
    assert.strictEqual(toPlainMarkdown('```py\ndef a():\n    pass\n\n\ndef b():\n    pass\n```', context), '```py\ndef a():\n    pass\n\n\ndef b():\n    pass\n```\n');
  });

  test('writes links in query results as their words, and an embed in an embed from its own note', () => {
    const linked = indexOf({
      'notes/A.md': '# A #project/x\n- [ ] Call [[Other|Bob]]',
      'notes/Other.md': '# Other\n## Part\nsee:\n\n![[#B]]\n## B\nbtext',
    });
    const linkedContext = { index: linked, queryContext: createQueryContext(new Date(2026, 9, 3).getTime()) };
    assert.strictEqual(toPlainMarkdown('```deckard\n#project/x is:task\n```', linkedContext), '- [ ] Call Bob\n');
    assert.ok(toPlainMarkdown('![[Other#Part]]', linkedContext).includes('btext'));
  });
});
