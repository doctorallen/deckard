import * as assert from 'assert';
import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { AssistantTools } from '../ui/commands/assistantTools';

/** Tools over a one-note index, registered with a stand-in for VS Code. */
function createTools() {
  const file = parseMarkdown(
    'notes/atlas.md',
    '# Atlas #project/atlas\n- [ ] Send the proposal\n',
  );
  const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
  const registered: string[] = [];
  const tools = new AssistantTools(
    { ready: Promise.resolve(), getSnapshot: () => index },
    (name) => {
      registered.push(name);
      return { dispose: () => undefined };
    },
  );
  return { tools, registered };
}

const token = new vscode.CancellationTokenSource().token;

async function readText(
  result: vscode.ProviderResult<vscode.LanguageModelToolResult>,
): Promise<string> {
  const settled = await result;
  return (settled?.content ?? [])
    .map((part) =>
      part instanceof vscode.LanguageModelTextPart ? part.value : '',
    )
    .join('');
}

suite('Assistant tool calls', () => {
  test('registers the query and tag tools', () => {
    const { registered } = createTools();
    assert.deepStrictEqual(registered, ['deckard_query', 'deckard_list_tags', 'deckard_add_task', 'deckard_change_task']);
  });

  test('asks before the first call in a session, and not after', async () => {
    const { tools } = createTools();

    const first = await tools.queryTool.prepareInvocation?.(
      { input: { query: 'task = open' } },
      token,
    );
    assert.ok(first?.confirmationMessages, 'the first call asks');
    assert.match(String(first?.invocationMessage), /task = open/);

    // VS Code runs a tool only after the user continues.
    const text = await readText(
      tools.queryTool.invoke(
        { input: { query: 'task = open' }, toolInvocationToken: undefined },
        token,
      ),
    );
    assert.match(text, /^Deckard query: task = open/);
    assert.match(text, /Send the proposal/);

    const later = await tools.tagsTool.prepareInvocation?.({ input: {} }, token);
    assert.strictEqual(later?.confirmationMessages, undefined);
    assert.match(
      await readText(
        tools.tagsTool.invoke({ input: {}, toolInvocationToken: undefined }, token),
      ),
      /#project\/atlas/,
    );
  });

  test('a write asks every time, even after a read was allowed', async () => {
    const { tools } = createTools();
    await tools.queryTool.invoke(
      { input: { query: 'tag = #project/atlas' }, toolInvocationToken: undefined },
      token,
    );
    const read = await tools.tagsTool.prepareInvocation?.({ input: {} }, token);
    assert.strictEqual(read?.confirmationMessages, undefined, 'reads are allowed for the session');

    const add = await tools.addTaskTool.prepareInvocation?.(
      { input: { text: 'Call Ren' } },
      token,
    );
    assert.ok(add?.confirmationMessages, 'adding still asks');
    assert.match(add?.invocationMessage as string, /Adding a task to today's note: Call Ren/);
    const change = await tools.changeTaskTool.prepareInvocation?.(
      { input: { note: 'notes/atlas.md', line: 2, complete: true } },
      token,
    );
    assert.ok(change?.confirmationMessages, 'changing still asks');
    assert.match(change?.invocationMessage as string, /notes\/atlas.md line 2/);
  });

  test('a write with nothing usable in it writes nothing, and says what to send', async () => {
    const { tools } = createTools();
    const text = await readText(
      tools.addTaskTool.invoke({ input: {}, toolInvocationToken: undefined }, token),
    );
    assert.match(text, /Send the task's words as "text"/);
    const change = await readText(
      tools.changeTaskTool.invoke({ input: { note: 'notes/atlas.md', line: 2 }, toolInvocationToken: undefined }, token),
    );
    assert.match(change, /at least one of: title, complete, due/);
  });

  test('asks again in a new session', async () => {
    const earlier = createTools().tools;
    await earlier.queryTool.invoke(
      { input: { query: 'task = open' }, toolInvocationToken: undefined },
      token,
    );

    const next = await createTools().tools.queryTool.prepareInvocation?.(
      { input: { query: 'task = open' } },
      token,
    );
    assert.ok(next?.confirmationMessages);
  });
});
