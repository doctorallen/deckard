import * as assert from 'assert';

import { Section, Task } from '../core/types';
import { csv, formatNotes, formatTasks, markdownTable, noteRows, taskRows } from '../ui/commands/exportResults';

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
