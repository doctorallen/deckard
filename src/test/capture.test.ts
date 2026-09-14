import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import {
  appendCapture,
  CaptureInsertion,
  completeLastWord,
  findSameSection,
  formatCaptureLine,
  getCaptureInsertion,
  getTagSuggestions,
} from '../ui/commands/capture';

/** The content once an insertion is made, as the editor would make it. */
function applyInsertion(content: string, insertion: CaptureInsertion): string {
  const lines = content.split('\n');
  const offset =
    lines
      .slice(0, insertion.line)
      .reduce((total, line) => total + line.length + 1, 0) + insertion.character;
  return content.slice(0, offset) + insertion.text + content.slice(offset);
}

function capture(content: string, heading?: string): { content: string; taskLine: number } {
  const section = heading
    ? parseMarkdown('day.md', content).sections.find((entry) => entry.heading === heading)
    : undefined;
  const insertion = getCaptureInsertion(content, '- [ ] New', section);
  return { content: applyInsertion(content, insertion), taskLine: insertion.taskLine };
}

suite('Quick capture', () => {
  const tags = [
    { label: '#project/atlas', count: 9 },
    { label: '#project/harbor', count: 3 },
    { label: '#risk/atlas-budget', count: 5 },
    { label: '@alex-smith', count: 4 },
  ];

  test('suggests tags for the word being typed, most used first', () => {
    assert.deepStrictEqual(getTagSuggestions('Call Ren #pro', tags), [
      '#project/atlas',
      '#project/harbor',
    ]);
    assert.deepStrictEqual(
      getTagSuggestions('Call Ren #atlas', tags),
      ['#project/atlas', '#risk/atlas-budget'],
      'tags containing the word follow',
    );
    assert.deepStrictEqual(getTagSuggestions('Ask (@al', tags), ['@alex-smith']);
    assert.deepStrictEqual(getTagSuggestions('Call Ren #pro ', tags), [], 'the word has ended');
    assert.deepStrictEqual(getTagSuggestions('Call Ren', tags), [], 'only tags are completed');
    assert.deepStrictEqual(getTagSuggestions('#project/atlas', tags), [], 'already complete');
    assert.strictEqual(getTagSuggestions('#', tags, '@', 2).length, 2, 'at most the limit');
  });

  test('completing a tag replaces the word being typed', () => {
    assert.strictEqual(
      completeLastWord('Call Ren #pro', '#project/atlas'),
      'Call Ren #project/atlas ',
    );
    assert.strictEqual(completeLastWord('Ask (@al', '@alex-smith'), 'Ask (@alex-smith ');
  });

  test('writes a capture as an open task', () => {
    assert.strictEqual(
      formatCaptureLine('  Call Ren #project/atlas '),
      '- [ ] Call Ren #project/atlas',
    );
    assert.strictEqual(formatCaptureLine('- Call Ren'), '- [ ] Call Ren');
    assert.strictEqual(formatCaptureLine('- [x] Called Ren'), '- [x] Called Ren');
  });

  test('adds a task after the last list item, or after a blank line', () => {
    assert.deepStrictEqual(capture('# 2026-09-13\n\n'), {
      content: '# 2026-09-13\n\n- [ ] New\n\n',
      taskLine: 2,
    });
    assert.deepStrictEqual(capture('# D\n\n- [ ] One\n'), {
      content: '# D\n\n- [ ] One\n- [ ] New\n',
      taskLine: 3,
    });
    assert.deepStrictEqual(capture('# D'), { content: '# D\n\n- [ ] New', taskLine: 2 });
    assert.deepStrictEqual(capture('- [ ] One'), {
      content: '- [ ] One\n- [ ] New',
      taskLine: 1,
    });
    assert.deepStrictEqual(capture(''), { content: '- [ ] New\n', taskLine: 0 });
    assert.strictEqual(
      getCaptureInsertion('# D\r\n\r\n', '- [ ] New').text,
      '\r\n- [ ] New\r\n',
      'the note keeps its line endings',
    );
  });

  test('adds a task at the end of a chosen heading', () => {
    const content = '# Day\n## Calls\n- [ ] One\n\n## Later\nText\n';
    assert.deepStrictEqual(capture(content, 'Calls'), {
      content: '# Day\n## Calls\n- [ ] One\n- [ ] New\n\n## Later\nText\n',
      taskLine: 3,
    });
    assert.deepStrictEqual(capture('# Day\n## Calls\n## Later\n', 'Calls'), {
      content: '# Day\n## Calls\n\n- [ ] New\n## Later\n',
      taskLine: 3,
    });
  });

  test('finds the chosen heading again in the note as it is now', () => {
    const saved = parseMarkdown('day.md', '# Day\n## Calls\nA\n## Calls\nB\n').sections;
    const live = parseMarkdown('day.md', '# Day\n## Intro\n## Calls\nA\n## Calls\nB\n').sections;
    const chosen = saved.filter((section) => section.heading === 'Calls')[1];

    const found = findSameSection(saved, chosen, live);
    assert.strictEqual(found?.heading, 'Calls');
    assert.strictEqual(found?.startLine, 5, 'the second Calls, moved down a line');
    assert.strictEqual(
      findSameSection(saved, chosen, parseMarkdown('day.md', '# Day\n## Calls\nA\n').sections),
      undefined,
      'a heading that is gone is not guessed',
    );
  });

  test('adds the task through the editor copy, keeping unsaved changes, and saves', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-capture-'));
    const file = join(directory, '2026-09-13.md');
    writeFileSync(file, '# 2026-09-13\n\n- [ ] One\n');
    const uri = vscode.Uri.file(file);
    try {
      await vscode.workspace.openTextDocument(uri);
      const draft = new vscode.WorkspaceEdit();
      draft.insert(uri, new vscode.Position(0, 0), '<!-- draft -->\n');
      assert.ok(await vscode.workspace.applyEdit(draft));

      const taskLine = await appendCapture(uri, '- [ ] Two');

      assert.strictEqual(taskLine, 4);
      assert.strictEqual(
        readFileSync(file, 'utf8'),
        '<!-- draft -->\n# 2026-09-13\n\n- [ ] One\n- [ ] Two\n',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
