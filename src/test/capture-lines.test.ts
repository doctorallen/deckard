import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import {
  CaptureInsertion,
  findSameSection,
  formatCaptureLine,
  getCaptureInsertion,
  writeCapture,
} from '../domain/capture/captureLines';
import { CaptureDrafts } from '../services/captureService';
import { completeLastWord, getTagSuggestions } from '../ui/commands/captureBox';

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

suite('Quick capture', () => {  const tags = [
    { label: '#project/atlas', count: 9 },
    { label: '#project/harbor', count: 3 },
    { label: '#risk/atlas-budget', count: 5 },
    { label: '@alex-smith', count: 4 },
  ];

  test('keeps what was typed for the command it was typed into', async () => {
    const stored = new Map<string, unknown>();
    const drafts = new CaptureDrafts({
      get: <T>(key: string) => stored.get(key) as T,
      update: async (key: string, value: unknown) => void stored.set(key, value),
    });

    await drafts.save({ text: 'Call Ren friday', target: 'today', literal: true });
    assert.deepStrictEqual(drafts.read('today'), {
      text: 'Call Ren friday',
      target: 'today',
      literal: true,
    });
    assert.strictEqual(drafts.read('heading'), undefined, 'kept for Capture, not the other');

    await drafts.clear();
    assert.strictEqual(drafts.read('today'), undefined);
  });

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

  test('adds under a heading\'s own lines, above a heading nested in it', () => {
    const content = '# Day\n## Next\n- [ ] One\n### Later\n- [ ] Deep\n';
    const next = parseMarkdown('day.md', content).sections.find((entry) => entry.heading === 'Next')!;
    const insertion = getCaptureInsertion(content, '- [ ] New', {
      startLine: next.startLine,
      endLine: next.bodyEndLine,
    });
    assert.strictEqual(
      applyInsertion(content, insertion),
      '# Day\n## Next\n- [ ] One\n- [ ] New\n### Later\n- [ ] Deep\n',
    );
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


  test('writes a capture as a task read on its day, as typed, or as a note line', () => {
    // Friday 2026-09-25, noon.
    const options = { format: 'emoji' as const, now: new Date(2026, 8, 25, 12).getTime(), dateOptions: {} };
    assert.strictEqual(writeCapture('Call Ren tomorrow p1', options), '- [ ] Call Ren 🔺 📅 2026-09-26');
    assert.strictEqual(
      writeCapture('Call Ren tomorrow', { ...options, format: 'dataview' }),
      '- [ ] Call Ren [due:: 2026-09-26]',
    );
    assert.strictEqual(writeCapture('Call Ren tomorrow', { ...options, literal: true }), '- [ ] Call Ren tomorrow');
    assert.strictEqual(writeCapture('- [ ] Call Ren tomorrow', { ...options, asNote: true }), '- Call Ren tomorrow');
  });
});
