import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import {
  answerQuery,
  answerTags,
  ASSISTANT_TOOLS,
  AssistantTool,
  ToolCall,
  ToolRunners,
} from '../ui/state/assistantTools';
import { AddTaskInput, ChangeTaskInput } from '../ui/state/assistantWriteInput';

/** A one-note index, the same the tool-call suites answer from. */
function createIndex() {
  const file = parseMarkdown(
    'notes/atlas.md',
    '# Atlas #project/atlas\n- [ ] Send the proposal\n',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  return buildWorkspaceIndex(new Map([[file.filePath, file]]));
}

/** Runners that answer from the index and record each write they are asked for. */
function createRunners() {
  const index = createIndex();
  const context = createQueryContext(Date.UTC(2026, 8, 21, 12));
  const writes: Array<{ tool: string; input: AddTaskInput | ChangeTaskInput }> = [];
  const runners: ToolRunners = {
    getSnapshot: () => index,
    readQueryContext: () => context,
    addTask: (input) => {
      writes.push({ tool: 'add', input });
      return Promise.resolve({ text: 'added' });
    },
    changeTask: (input) => {
      writes.push({ tool: 'change', input });
      return Promise.resolve({ text: 'declined', isError: true });
    },
  };
  return { index, context, runners, writes };
}

/** The table's entry for a tool, which every test here expects to exist. */
function tool(name: string): AssistantTool {
  const found = ASSISTANT_TOOLS.find((entry) => entry.name === name);
  assert.ok(found, `the table has ${name}`);
  return found;
}

/** The refusal a call was read as, failing when it was bound to run instead. */
function refusal(call: ToolCall<unknown>) {
  assert.strictEqual(call.kind, 'invalid');
  return call.kind === 'invalid' ? call.text : { languageModel: '', mcp: '' };
}

/** What a bound call answers, failing when it was refused instead. */
function run(call: ToolCall<unknown>): unknown {
  assert.strictEqual(call.kind, 'run');
  if (call.kind !== 'run') {
    throw new Error('The call was refused.');
  }
  return call.run();
}

suite('Assistant tool table', () => {
  test('holds the four tools in the order VS Code registers them', () => {
    assert.deepStrictEqual(
      ASSISTANT_TOOLS.map((entry) => [entry.name, entry.kind]),
      [
        ['deckard_query', 'read'],
        ['deckard_list_tags', 'read'],
        ['deckard_add_task', 'write'],
        ['deckard_change_task', 'write'],
      ],
    );
  });

  test('times each tool under its own name on each surface', () => {
    assert.deepStrictEqual(
      ASSISTANT_TOOLS.map((entry) => entry.measure),
      [
        { languageModel: 'Assistant query', mcp: 'MCP query' },
        { languageModel: 'Assistant tag list', mcp: 'MCP tag list' },
        { languageModel: 'Assistant add task', mcp: 'MCP add task' },
        { languageModel: 'Assistant change task', mcp: 'MCP change task' },
      ],
    );
  });

  test('a query answers as answerQuery does, and a call without one is refused alike on both surfaces', () => {
    const { index, context, runners } = createRunners();
    const query = tool('deckard_query');
    assert.strictEqual(
      run(query.read({ query: 'task = open', limit: 5 }, runners)),
      answerQuery(index, { query: 'task = open', limit: 5 }, context),
    );
    for (const junk of [undefined, 'task = open', {}, { query: 7 }]) {
      assert.deepStrictEqual(refusal(query.read(junk, runners)), {
        languageModel: 'Send a Deckard query as "query", such as tag = #project/atlas AND task = open.',
        mcp: 'Send a Deckard query as "query", such as tag = #project/atlas AND task = open.',
      });
    }
  });

  test('the tag list takes any input, and lists every tag for one that is not an object', () => {
    const { index, runners } = createRunners();
    const tags = tool('deckard_list_tags');
    assert.strictEqual(run(tags.read({ search: 'atlas' }, runners)), answerTags(index, { search: 'atlas' }));
    assert.strictEqual(run(tags.read('junk', runners)), answerTags(index, {}));
    assert.strictEqual(run(tags.read(undefined, runners)), answerTags(index, {}));
  });

  test('an add-task call is handed to the write as read, and each surface refuses a bad one in its own words', async () => {
    const { runners, writes } = createRunners();
    const add = tool('deckard_add_task');
    const answer = await run(add.read({ text: '  Call  Ren ', note: 'notes/atlas.md' }, runners));
    assert.deepStrictEqual(answer, { text: 'added' });
    assert.deepStrictEqual(writes, [{ tool: 'add', input: { text: 'Call Ren', note: 'notes/atlas.md' } }]);

    for (const junk of [undefined, { text: '' }, { text: 'x'.repeat(501) }, { note: 'notes/atlas.md' }]) {
      assert.deepStrictEqual(refusal(add.read(junk, runners)), {
        languageModel:
          'Send the task\'s words as "text", and optionally a workspace-relative "note" to add it to; today\'s note otherwise.',
        mcp: 'Send the task\'s words as "text", and optionally a workspace-relative "note".',
      });
    }
    assert.strictEqual(writes.length, 1, 'a refused call writes nothing');
  });

  test('a change-task call is handed to the write as read, and each surface refuses a bad one in its own words', async () => {
    const { runners, writes } = createRunners();
    const change = tool('deckard_change_task');
    const answer = await run(change.read({ note: 'notes/atlas.md', line: 2, complete: true }, runners));
    assert.deepStrictEqual(answer, { text: 'declined', isError: true });
    assert.deepStrictEqual(writes, [
      { tool: 'change', input: { note: 'notes/atlas.md', line: 2, complete: true } },
    ]);

    for (const junk of [undefined, { note: 'notes/atlas.md', line: 2 }, { note: '', line: 2, complete: true }, { note: 'a.md', line: 0, complete: true }]) {
      assert.deepStrictEqual(refusal(change.read(junk, runners)), {
        languageModel:
          'Send the task\'s "note" and "line" as deckard_query reports them, and at least one of: title, complete, due (YYYY-MM-DD or null), priority (highest, high, medium, low, lowest, or null), assignee (a person tag, or null).',
        mcp: 'Send "note" and "line" as deckard_query reports them, and at least one change.',
      });
    }
    assert.strictEqual(writes.length, 1, 'a refused call writes nothing');
  });

  test('reading a call runs nothing until the surface runs it', () => {
    let reads = 0;
    const { runners } = createRunners();
    const counting: ToolRunners = {
      ...runners,
      getSnapshot: () => {
        reads += 1;
        return runners.getSnapshot();
      },
    };
    const call = tool('deckard_query').read({ query: 'task = open' }, counting);
    assert.strictEqual(reads, 0);
    run(call);
    assert.strictEqual(reads, 1);
  });

  test('VS Code offers every tool, the writes too, only while the Assistant Tools setting is on', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { contributes: { languageModelTools: { name: string; when?: string }[] } };
    assert.deepStrictEqual(
      manifest.contributes.languageModelTools.map((declared) => [declared.name, declared.when]),
      ASSISTANT_TOOLS.map((declared) => [declared.name, 'config.deckard.assistantTools']),
    );
  });

  test('the settings that turn the tools on say they can add and change tasks, and how a write is approved', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as {
      contributes: {
        configuration: Array<{ properties: Record<string, { description?: string; markdownDescription?: string }> }>;
      };
    };
    const settings = Object.assign({}, ...manifest.contributes.configuration.map((section) => section.properties)) as Record<
      string,
      { description?: string; markdownDescription?: string }
    >;
    assert.ok(ASSISTANT_TOOLS.some((declared) => declared.kind === 'write'), 'the tools include writes');
    for (const key of ['deckard.assistantTools', 'deckard.mcpServer.enabled']) {
      const text = settings[key].markdownDescription ?? settings[key].description ?? '';
      assert.match(text, /add a task/, `${key} says the tools add tasks`);
      assert.match(text, /change an existing task/, `${key} says the tools change tasks`);
      assert.match(text, /refactor preview/, `${key} says where a write is approved`);
    }
  });

  test('says what each tool is doing while VS Code runs it', () => {
    assert.strictEqual(
      tool('deckard_query').progressMessage({ query: 'task = open' }),
      'Searching Deckard notes and tasks: task = open',
    );
    assert.strictEqual(
      tool('deckard_query').progressMessage({ query: 'x'.repeat(100) }),
      `Searching Deckard notes and tasks: ${'x'.repeat(79)}…`,
    );
    assert.strictEqual(tool('deckard_query').progressMessage(undefined), 'Searching Deckard notes and tasks: ');
    assert.strictEqual(tool('deckard_list_tags').progressMessage({ search: ' atlas ' }), 'Listing Deckard tags matching atlas');
    assert.strictEqual(tool('deckard_list_tags').progressMessage({ search: '  ' }), 'Listing Deckard tags');
    assert.strictEqual(
      tool('deckard_add_task').progressMessage({ text: 'Call Ren', note: 'notes/atlas.md' }),
      'Adding a task to notes/atlas.md: Call Ren',
    );
    assert.strictEqual(
      tool('deckard_add_task').progressMessage({ text: 'Call Ren' }),
      "Adding a task to today's note: Call Ren",
    );
    assert.strictEqual(tool('deckard_add_task').progressMessage({}), 'Adding a task');
    assert.strictEqual(
      tool('deckard_change_task').progressMessage({ note: 'notes/atlas.md', line: 2, title: 'Send it' }),
      'Changing the task at notes/atlas.md line 2',
    );
    assert.strictEqual(tool('deckard_change_task').progressMessage({ note: 'notes/atlas.md', line: 2 }), 'Changing a task');
  });
});
