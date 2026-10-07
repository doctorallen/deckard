import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { evaluateQuery, readTaskTagKeys } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  formatNamespaceValue,
  listTaskNamespaces,
  noValueLabel,
} from '../ui/state/tagGrouping';
import { resolveTaskMove, TaskBoardOptions } from '../ui/state/taskBoardState';
import { createAgenda } from '../ui/state/agendaState';
import * as vscode from 'vscode';

import { AGENDA_TASK_MIME, AgendaNode, AgendaTreeProvider } from '../ui/views/agendaTree';
import { createQueryContext } from '../domain/query/queryContext';
import { createAgendaTreeServices } from './taskWrites';
import { groupColumnId } from '../domain/tasks/agendaGroups';
import { Task, WorkspaceIndex } from '../domain/model';

const options: TaskBoardOptions = {
  queryContext: createQueryContext(new Date(2026, 8, 13, 9).getTime()),
  format: 'emoji',
};

const NOTE = [
  '---',
  'tags: [area/health]',
  '---',
  '# Atlas #project/atlas',
  '## Calls',
  '- [ ] Call Ren #context/phone',
  '- [ ] Draft #context/computer #context/phone ^draft',
  '- [ ] Loose',
  '- [x] Filed #context/errands',
  '- [ ] Pay #organization/acme',
  '',
].join('\n');

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)])),
  );
}

function taskNamed(index: WorkspaceIndex, word: string): Task {
  const task = [...index.tasks.values()].find((candidate) => candidate.title.startsWith(word));
  assert.ok(task, word);
  return task;
}

/** The line a move writes, from the task's own line. */
function moved(index: WorkspaceIndex, word: string, to: string, from?: string): string | undefined {
  const task = taskNamed(index, word);
  const move = resolveTaskMove(task, to, options, { index, from });
  if (move.kind === 'edit') {
    return move.edit(task.sourceLineText);
  }
  return move.kind === 'refused' ? `refused: ${move.reason}` : move.kind;
}

suite('Grouping tasks by a tag namespace', () => {
  test('a task holds a tag exactly when tag: finds it, inherited tags included', () => {
    const index = indexOf({ 'a.md': NOTE, 'b.md': '# Other\n### Deep #project/b\n#### Deeper\n- [ ] Nested\n' });
    const keys = [...index.tags.keys()];
    index.tasks.forEach((task) => {
      const held = readTaskTagKeys(index, task);
      keys.forEach((key) => {
        const found = evaluateQuery(index, parseQuery(`tag = ${key}`).node, createQueryContext(Date.now())).tasks.some(
          (candidate) => candidate.id === task.id,
        );
        assert.strictEqual(held.has(key), found, `${task.title} / ${key}`);
      });
    });
    assert.ok(readTaskTagKeys(index, taskNamed(index, 'Nested')).has('#project/b'), 'two headings up');
  });

  test('lists the namespaces open tasks carry, busiest first, without status or people', () => {
    const index = indexOf({ 'a.md': NOTE + '- [ ] Waiting #status/waiting @dana\n' });
    const namespaces = listTaskNamespaces(index, ['status']);
    assert.deepStrictEqual(
      namespaces.map((namespace) => [namespace.name, namespace.openTasks]),
      [
        ['area', 5],
        ['project', 5],
        ['context', 2],
        ['org', 1],
      ],
    );
    assert.deepStrictEqual(namespaces[2].values, ['phone', 'computer']);
  });

  test('names a group the way a status reads, keeping a written capital', () => {
    assert.strictEqual(formatNamespaceValue('q3-launch'), 'Q3 launch');
    assert.strictEqual(formatNamespaceValue('iOS'), 'iOS');
    assert.strictEqual(formatNamespaceValue('deckard/ui'), 'Deckard/ui');
    assert.strictEqual(noValueLabel('Context'), 'No context');
  });

  test('turns a drop between tags into an edit of the task line', () => {
    const index = indexOf({ 'a.md': NOTE });
    assert.strictEqual(moved(index, 'Loose', 'tag:context/phone'), '- [ ] Loose #context/phone', 'appends');
    assert.strictEqual(
      moved(index, 'Call Ren', 'tag:context/errands', 'tag:context/phone'),
      '- [ ] Call Ren #context/errands',
      'replaces in place',
    );
    assert.strictEqual(
      moved(index, 'Draft', 'tag:context/phone', 'tag:context/computer'),
      '- [ ] Draft #context/phone ^draft',
      'takes out only the one it came from when the other is there',
    );
    assert.strictEqual(
      moved(index, 'Draft', 'tag:context/errands', 'tag:context/computer'),
      '- [ ] Draft #context/errands #context/phone ^draft',
      'the other tag stays',
    );
    assert.strictEqual(moved(index, 'Call Ren', 'tag:context/phone'), 'unchanged');
    assert.strictEqual(moved(index, 'Draft', 'tag:context/', 'tag:context/phone'), '- [ ] Draft ^draft', 'No context takes every one');
    assert.strictEqual(moved(index, 'Filed', 'tag:context/phone', 'done'), '- [ ] Filed #context/errands #context/phone', 'reopens');
    assert.strictEqual(moved(index, 'Pay', 'tag:org/', 'tag:org/acme'), '- [ ] Pay', 'an alias is found by its label');
    assert.strictEqual(moved(index, 'Loose', 'tag:context/errands', 'tag:context/'), '- [ ] Loose #context/errands');
  });

  test('refuses to take away a tag a heading or front matter gave', () => {
    const index = indexOf({ 'a.md': NOTE });
    assert.strictEqual(
      moved(index, 'Call Ren', 'tag:project/other', 'tag:project/atlas'),
      'refused: "Call Ren #context/phone" is in #project/atlas because its heading "Atlas" is, so moving it cannot take it out. Change the heading instead.',
    );
    assert.strictEqual(
      moved(index, 'Loose', 'tag:area/', 'tag:area/health'),
      'refused: "Loose" is in #area/health because its note\'s front matter is, so moving it cannot take it out. Change the front matter instead.',
    );
  });

  test('refuses a column whose tag would not read back as itself', () => {
    const index = indexOf({ 'a.md': NOTE });
    assert.match(moved(index, 'Loose', 'tag:context/has space') ?? '', /^refused: Deckard cannot write "#context\/has space" as a tag\.$/);
    assert.match(moved(index, 'Loose', 'tag:9bad/x') ?? '', /^refused: /);
  });

  test('the Tasks view groups by a namespace, counting inherited tags, a task in each of its groups', () => {
    const index = indexOf({ 'a.md': NOTE });
    const groups = (namespace: string) =>
      createAgenda(index, createQueryContext(options.queryContext.now), { upcomingDays: 7, groupBy: 'tag', groupNamespace: namespace }).map(
        (group) => [
          group.id,
          group.label,
          group.entries.map((entry) => entry.title.replace(/\s+#\S+/g, '')),
        ],
      );
    assert.deepStrictEqual(groups('context'), [
      ['tag:context/phone', 'Phone', ['Call Ren', 'Draft']],
      ['tag:context/computer', 'Computer', ['Draft']],
      ['tag:context/', 'No context', ['Loose', 'Pay']],
    ]);
    const draft = createAgenda(index, createQueryContext(options.queryContext.now), { upcomingDays: 7, groupBy: 'tag', groupNamespace: 'context' })[0]
      .entries.find((entry) => entry.title.startsWith('Draft'));
    assert.strictEqual(draft?.details[draft.details.length - 1], 'also in Computer');
    assert.deepStrictEqual(groups('project').map(([id, , titles]) => [id, (titles as string[]).length]), [['tag:project/atlas', 4]]);
    assert.deepStrictEqual(groups('area').map(([id, label]) => [id, label]), [['tag:area/health', 'Health']]);
  });

  test('a tag group is the board column of the same name', () => {
    assert.strictEqual(groupColumnId('tag:context/phone', 'tag'), 'tag:context/phone');
    assert.strictEqual(groupColumnId('tag:context/', 'tag'), 'tag:context/');
    assert.strictEqual(groupColumnId('donetoday', 'tag'), 'done');
  });

  test('the Tasks view draws a task in two groups as two items, and drags it with its group', async () => {
    const index = indexOf({ 'a.md': NOTE });
    const updates = new vscode.EventEmitter<WorkspaceIndex>();
    const provider = new AgendaTreeProvider(
      {
        onDidUpdate: updates.event,
        getTask: (taskId) => index.tasks.get(taskId),
      },
      createAgendaTreeServices((taskId) => index.tasks.get(taskId), undefined, { agendaGroupBy: 'tag', agendaGroupNamespace: 'context' }),
    );
    try {
      updates.fire(index);
      const groups = await provider.getChildren();
      assert.deepStrictEqual(
        groups.map((group) => (group.kind === 'group' ? group.group.id : '')).slice(0, 3),
        ['tag:context/phone', 'tag:context/computer', 'tag:context/'],
      );
      assert.strictEqual(provider.getTreeItem(groups[0]).tooltip, 'Tasks tagged #context/phone on their line, a heading above them, or their note\'s front matter. Drag a task here to tag it.');
      const rows = [...(await provider.getChildren(groups[0])), ...(await provider.getChildren(groups[1]))];
      const ids = rows.map((row) => provider.getTreeItem(row).id);
      assert.strictEqual(new Set(ids).size, ids.length, 'every item has an id of its own');
      const draft = rows[rows.length - 1] as Extract<AgendaNode, { kind: 'task' }>;
      const data = new vscode.DataTransfer();
      provider.handleDrag([draft], data);
      assert.deepStrictEqual(data.get(AGENDA_TASK_MIME)?.value, [
        { taskId: draft.entry.task.id, groupId: 'tag:context/computer' },
      ]);
    } finally {
      provider.dispose();
      updates.dispose();
    }
  });
});
