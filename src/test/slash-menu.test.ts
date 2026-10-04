import * as assert from 'assert';

import { escapeSnippetText, findSlashQuery, isOutsideProse, listSlashChoices, templateToSnippet } from '../domain/markdown/slashMenu';

suite('The / menu', () => {
  test('opens only for a / alone at a line’s start', () => {
    assert.deepStrictEqual(findSlashQuery('/'), { start: 0, word: '' });
    assert.deepStrictEqual(findSlashQuery('  /tab'), { start: 2, word: 'tab' });
    assert.deepStrictEqual(findSlashQuery('\t/heading-1'), { start: 1, word: 'heading-1' });
    for (const before of ['a /', 'notes/', '2026/10', '- [ ] /due', '//', '/ x', '- /']) {
      assert.strictEqual(findSlashQuery(before), undefined, before);
    }
  });

  test('lists the blocks a note is written with, today’s among them', () => {
    const choices = listSlashChoices({ today: '2026-10-03' });
    assert.deepStrictEqual(choices.slice(0, 4).map((choice) => choice.label), ['Task', 'Heading 1', 'Heading 2', 'Heading 3']);
    const byLabel = new Map(choices.map((choice) => [choice.label, choice]));
    assert.strictEqual(byLabel.get('Task')?.snippet, '- [ ] $0');
    assert.strictEqual(byLabel.get('Today’s note')?.snippet, '[[2026-10-03]]$0');
    assert.strictEqual(byLabel.get('Link to a note')?.suggestAfter, true);
    assert.match(byLabel.get('Notes table')?.snippet ?? '', /^```deckard view=table noteColumns=updated,links,tasks\n\$\{1:tag = #project\/\* AND is:note\}\n```\n\$0$/);
    assert.strictEqual(new Set(choices.map((choice) => choice.label)).size, choices.length, 'each label once');
  });

  test('writes a template as a snippet: variables filled, questions as tab stops, text as written', () => {
    const snippet = templateToSnippet(
      '# {title}\nDate: {date}\nWith {ask:Who came?} about {ask:Topic}.\nThanks {ask: Who came? }. Cost: $5 {unknown} \\o/',
      { title: 'Check-in', date: '2026-10-03', time: '09:00' },
    );
    assert.strictEqual(
      snippet,
      '# Check-in\nDate: 2026-10-03\nWith ${1:Who came?} about ${2:Topic}.\nThanks ${1:Who came?}. Cost: \\$5 {unknown\\} \\\\o/$0',
    );
    assert.strictEqual(escapeSnippetText('a$b}c\\d'), 'a\\$b\\}c\\\\d');
  });

  test('leaves a template’s front matter out, and stays out of front matter and indented code', () => {
    assert.strictEqual(templateToSnippet('---\ntags: [meeting]\n---\n# {title}', { title: 'T' }), '# T$0');
    const note = ['---', 'tags: x', '', '---', '# Note', '- item', '    /', '', 'text', '    /', '\t/'];
    assert.deepStrictEqual([1, 2, 6, 9].map((line) => isOutsideProse(note, line)), [true, true, false, true]);
    assert.strictEqual(isOutsideProse(note, 8), false);
    assert.strictEqual(listSlashChoices({ today: '2026-10-03' }).find((choice) => choice.label === 'Divider')?.snippet, '***\n$0');
  });
});
