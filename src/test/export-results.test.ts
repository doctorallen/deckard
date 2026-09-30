import * as assert from 'assert';

import { Section, Task } from '../domain/model';
import { csv, formatNotes, formatTasks, markdownTable, noteRows, taskRows } from '../domain/export/exportFormats';
import { findQueryBlocks, formatQueryBlock } from '../ui/state/queryBlockState';

suite('Exporting results', () => {
  const section = (over: Partial<Section> = {}): Section => ({
    id: 'sec', filePath: 'notes/Atlas plan.md', heading: 'Atlas | kickoff', headingLevel: 2,
    tags: ['#project/atlas'], tagLabels: { '#project/atlas': '#project/atlas' }, links: [],
    rawContent: '', bodyContent: '', startLine: 4, endLine: 9, bodyEndLine: 9, updatedAt: Date.UTC(2026, 8, 20),
    ...over,
  });
  const task = (over: Partial<Task> = {}): Task => ({
    id: 't', filePath: 'notes/2026-09-20.md', sectionId: 'sec', title: 'Ship it, "carefully"', completed: false,
    tags: ['#project/atlas'], tagLabels: { '#project/atlas': '#project/atlas' },
    dueText: '2026-09-21', priority: 'high', assignee: '@ren', lineNumber: 9,
    checkboxColumn: 3, checkboxValue: ' ', sourceLineText: '- [ ] Ship it', ...over,
  });
  const index = { sections: new Map([['sec', section({ heading: 'Plan' })]]) };

  test('a search becomes a live query block that reads back as written', () => {
    assert.strictEqual(formatQueryBlock('#project/atlas is:open'), '```deckard\n#project/atlas is:open\n```\n');
    assert.strictEqual(formatQueryBlock('#a', { sort: 'updated' }), '```deckard sort=updated\n#a\n```\n');
    const table = formatQueryBlock('is:open', { view: 'table', columns: ['title', 'due'], sort: 'due', direction: 'desc' });
    assert.strictEqual(table, '```deckard view=table columns=title,due sort=due dir=desc\nis:open\n```\n');
    const fenced = formatQueryBlock('text ~ "```"');
    assert.ok(fenced.startsWith('````deckard'), 'a run of three backticks in the search takes a fence of four');
    for (const block of [table, fenced, formatQueryBlock('#a', { sort: 'created' })]) {
      const [found] = findQueryBlocks(`# Note\n\n${block}`);
      assert.ok(found, 'the block is found');
      assert.deepStrictEqual(found.options.warnings, [], 'with no warnings');
      assert.ok(found.closed, 'and closed');
    }
  });

  test('CSV quotes a comma, a quote, and a line break, and doubles the quote', () => {
    assert.strictEqual(
      csv(['a', 'b'], [['plain', 'has, comma'], ['has "quote"', 'two\nlines']]),
      'a,b\r\nplain,"has, comma"\r\n"has ""quote""","two\nlines"\r\n',
    );
  });

  test('a Markdown table escapes a pipe and folds a line break', () => {
    assert.strictEqual(
      markdownTable(['x'], [['a | b'], ['two\nlines']]),
      '| x |\n| --- |\n| a \\| b |\n| two lines |\n',
    );
  });

  test('notes go out with their title, tags, note, line and date', () => {
    const rows = noteRows([section()]);
    const table = formatNotes(rows, 'markdown-table');
    assert.strictEqual(table.split('\n')[2], '| Atlas \\| kickoff | #project/atlas | notes/Atlas plan.md | 4 | 2026-09-20 |');
    assert.strictEqual(formatNotes(rows, 'csv').split('\r\n')[1], 'Atlas | kickoff,#project/atlas,notes/Atlas plan.md,4,2026-09-20');
    assert.strictEqual(formatNotes(rows, 'markdown-list'), '- [Atlas | kickoff](notes/Atlas%20plan.md#L4) — #project/atlas\n');
  });

  test('tasks go out with what a board shows, and a list reads as tasks again', () => {
    const rows = formatTasks(taskRows([task(), task({ completed: true, dueText: undefined, priority: undefined, assignee: undefined })], index), 'csv').split('\r\n');
    assert.strictEqual(rows[0], 'Done,Task,Due,Priority,For,Tags,Note,Heading,Line');
    assert.strictEqual(rows[1], ',"Ship it, ""carefully""",2026-09-21,high,@ren,#project/atlas,notes/2026-09-20.md,Plan,9');
    assert.strictEqual(rows[2].slice(0, 2), 'x,');
    const list = formatTasks(taskRows([task()], index), 'markdown-list');
    assert.strictEqual(list, '- [ ] Ship it, "carefully" 📅 2026-09-21 👤 @ren ([2026-09-20.md](notes/2026-09-20.md#L9))\n');
  });
});
