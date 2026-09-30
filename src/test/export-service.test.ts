import * as assert from 'assert';

import { Section, Task } from '../domain/model';
import { ExportService, SearchResults } from '../services/exportService';

suite('ExportService', () => {
  const section = (over: Partial<Section> = {}): Section => ({
    id: 'sec', filePath: 'notes/Atlas.md', heading: 'Plan', headingLevel: 2,
    tags: [], tagLabels: {}, links: [], rawContent: '', bodyContent: '',
    startLine: 4, endLine: 9, bodyEndLine: 9, ...over,
  });
  const task = (over: Partial<Task> = {}): Task => ({
    id: 't', filePath: 'notes/Atlas.md', sectionId: 'sec', title: 'Ship it', completed: false,
    tags: [], tagLabels: {}, lineNumber: 6, checkboxColumn: 3, checkboxValue: ' ',
    sourceLineText: '- [ ] Ship it', ...over,
  });
  const found: SearchResults = { tasks: [task()], sections: [section(), section({ id: 'b', heading: 'Budget' })] };

  /** A service whose search finds `results` for any query, and records the queries. */
  function service(results: SearchResults = found) {
    const searched: string[] = [];
    const exports = new ExportService({
      index: { getSnapshot: () => ({ sections: new Map([['sec', section()]]) }) },
      search: (query) => {
        searched.push(query);
        return results;
      },
      queryBlock: (query) => `block ${query}`,
    });
    return { exports, searched };
  }

  test('a search exports everything it found, with its live block', () => {
    const { exports, searched } = service();

    const tasks = exports.fromSearch('#atlas is:open', 'tasks');
    assert.strictEqual(tasks.kind, 'results');
    assert.deepStrictEqual(searched, ['#atlas is:open']);
    if (tasks.kind === 'results') {
      assert.strictEqual(tasks.count, 1);
      assert.strictEqual(tasks.text('csv'), 'Done,Task,Due,Priority,For,Tags,Note,Heading,Line\r\n,Ship it,,,,,notes/Atlas.md,Plan,6\r\n');
      assert.strictEqual(tasks.liveBlock?.(), 'block #atlas is:open');
    }

    const notes = exports.fromSearch('#atlas', 'notes');
    assert.strictEqual(notes.kind === 'results' ? notes.count : 0, 2);
  });

  test('results with no search have no live block', () => {
    const plan = service().exports.fromResults('notes', found);
    assert.strictEqual(plan.kind, 'results');
    assert.strictEqual(plan.kind === 'results' ? plan.liveBlock : 'none', undefined);
    const blank = service().exports.fromResults('notes', found, '   ');
    assert.strictEqual(blank.kind === 'results' ? blank.liveBlock : 'none', undefined);
  });

  test('nothing found is nothing to export', () => {
    const { exports } = service({ tasks: [], sections: [] });
    assert.deepStrictEqual(exports.fromSearch('#gone', 'tasks'), { kind: 'nothing', what: 'tasks' });
    assert.deepStrictEqual(exports.fromSearch('#gone', 'notes'), { kind: 'nothing', what: 'notes' });
  });
});
