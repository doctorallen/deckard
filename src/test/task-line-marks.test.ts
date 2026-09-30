import * as assert from 'assert';

import * as vscode from 'vscode';

import { findTaskMetadataSpans, parseTaskMetadata } from '../domain/markdown/taskMetadata';
import { TaskLineDecorations } from '../ui/commands/taskLineDecorations';
import { findTaskLineMarks } from '../ui/state/taskLineMarks';
import { createQueryContext } from '../domain/query/queryContext';

/** Friday 2026-09-25, mid-morning. */
const now = new Date(2026, 8, 25, 10, 0, 0).getTime();
const both = { dim: true, hints: true };

/** The text each span covers on its line. */
function texts(lines: string[], spans: { line: number; start: number; end: number }[]): string[] {
  return spans.map((span) => lines[span.line].slice(span.start, span.end));
}

suite('Task metadata spans', () => {
  const fixtures = [
    'Send proposal 📅 2026-09-20 ⏳ 2026-09-18 🛫 2026-09-15 ➕ 2026-09-01 🔁 every week ⏫ 🆔 a1 ⛔ b2, c3 #project/atlas',
    'Plan 🗓️ 2026-09-20 ⌛ 2026-09-18 🔺️',
    'Circulate triggers 📅2026-09-12 ^triggers',
    'Call Ren 📅 2026-09-20 by 2026-09-30 🔽 🔁 every month',
    'Ship [due:: 2026-09-20] (priority:: high) [owner:: Ren] [repeat:: every week when done]',
    'Hand over 👤 @dana 🏁 delete ✅ 2026-09-01',
    'Twice 📅 2026-09-20 📅 2026-09-21',
  ];

  test('cutting the spans out leaves the title, and they read what the parser reads', () => {
    for (const text of fixtures) {
      const spans = findTaskMetadataSpans(text);
      let rest = text;
      for (const span of [...spans].reverse()) {
        rest = rest.slice(0, span.start) + ' ' + rest.slice(span.end);
      }
      const { metadata, title } = parseTaskMetadata(text);
      assert.strictEqual(rest.replace(/[ \t]{2,}/g, ' ').trim(), title, text);
      const first = (field: string) => spans.find((span) => span.field === field)?.value;
      for (const field of ['due', 'scheduled', 'start', 'created', 'done', 'id', 'assignee'] as const) {
        assert.strictEqual(first(field), metadata[field], `${field} of ${text}`);
      }
      assert.strictEqual(first('repeat'), metadata.recurrence, text);
      assert.strictEqual(first('priority'), metadata.priority, text);
    }
  });

  test('marks the block id and leaves other Dataview fields in the words', () => {
    const text = 'Ship [owner:: Ren] ^abc';
    assert.deepStrictEqual(
      findTaskMetadataSpans(text).map((span) => [span.field, text.slice(span.start, span.end)]),
      [['blockId', '^abc']],
    );
  });
});

suite('Task line marks', () => {
  test('an overdue task says so, in its own color, and the rest steps back', () => {
    const lines = ['- [ ] Send proposal 📅 2026-09-20 ⏫ 🔁 every week'];
    const marks = findTaskLineMarks(lines, createQueryContext(now), both);
    assert.deepStrictEqual(texts(lines, marks.overdue), ['📅 2026-09-20']);
    assert.deepStrictEqual(texts(lines, marks.dim), ['⏫', '🔁 every week']);
    assert.deepStrictEqual(marks.hints, [{ line: 0, text: 'overdue 5 days', tone: 'overdue' }]);
  });

  test('a task long overdue needs a new date, and is not red', () => {
    const lines = ['- [ ] Old 📅 2026-08-01'];
    const marks = findTaskLineMarks(lines, createQueryContext(now), both);
    assert.deepStrictEqual(marks.overdue, []);
    assert.deepStrictEqual(texts(lines, marks.dim), ['📅 2026-08-01']);
    assert.deepStrictEqual(marks.hints, [{ line: 0, text: 'needs a new date', tone: 'hint' }]);
  });

  test('says due today, and nothing for a later day', () => {
    assert.deepStrictEqual(findTaskLineMarks(['- [ ] Now 📅 2026-09-25'], createQueryContext(now), both).hints, [
      { line: 0, text: 'due today', tone: 'hint' },
    ]);
    assert.deepStrictEqual(findTaskLineMarks(['- [ ] Later 📅 2026-09-28'], createQueryContext(now), both).hints, []);
  });

  test('a done task is dimmed and says nothing', () => {
    const lines = ['- [x] Done 📅 2026-09-20 ✅ 2026-09-21'];
    const marks = findTaskLineMarks(lines, createQueryContext(now), both);
    assert.deepStrictEqual(texts(lines, marks.dim), ['📅 2026-09-20', '✅ 2026-09-21']);
    assert.deepStrictEqual(marks.overdue, []);
    assert.deepStrictEqual(marks.hints, []);
  });

  test('a block id on prose steps back; code and front matter are left alone', () => {
    const lines = ['---', 'x: - [ ] y 📅 2026-09-20', '---', 'A line ^abc', '```', '- [ ] In code 📅 2026-09-20', '```'];
    const marks = findTaskLineMarks(lines, createQueryContext(now), both);
    assert.deepStrictEqual(texts(lines, marks.dim), ['^abc']);
    assert.deepStrictEqual(marks.hints, []);
  });

  test('each half can be turned off', () => {
    const lines = ['- [ ] Send 📅 2026-09-20 ⏫'];
    assert.deepStrictEqual(findTaskLineMarks(lines, createQueryContext(now), { dim: true, hints: false }).hints, []);
    const undimmed = findTaskLineMarks(lines, createQueryContext(now), { dim: false, hints: true });
    assert.deepStrictEqual(undimmed.dim, []);
    assert.deepStrictEqual(texts(lines, undimmed.overdue), ['📅 2026-09-20']);
  });
});

suite('Task line decorations', () => {
  /** An editor that records what was set on it. */
  function fakeEditor(content: string, path = '/notes/plan.md') {
    const set = new Map<vscode.TextEditorDecorationType, readonly unknown[]>();
    const lines = content.split('\n');
    const editor = {
      document: {
        uri: vscode.Uri.file(path),
        lineCount: lines.length,
        getText: () => content,
        lineAt: (line: number) => ({
          range: new vscode.Range(line, 0, line, lines[line].length),
        }),
      },
      setDecorations: (type: vscode.TextEditorDecorationType, ranges: readonly unknown[]) => set.set(type, ranges),
    } as unknown as vscode.TextEditor;
    return { editor, set };
  }

  test('draws on a note, clears on anything else, and zen drops the hints', async () => {
    const decorations = new TaskLineDecorations((uri) => uri.path.startsWith('/notes/'), () => now);
    const configuration = vscode.workspace.getConfiguration('deckard');
    try {
      const note = fakeEditor('- [ ] Send 📅 2026-09-20 ⏫');
      decorations.update(note.editor);
      const counts = [...note.set.values()].map((ranges) => ranges.length).sort();
      assert.deepStrictEqual(counts, [1, 1, 1], 'dim, overdue, and one hint');

      const other = fakeEditor('- [ ] Send 📅 2026-09-20 ⏫', '/code/README.md');
      decorations.update(other.editor);
      assert.deepStrictEqual([...other.set.values()].map((ranges) => ranges.length), [0, 0, 0]);

      await configuration.update('zenMode', true, vscode.ConfigurationTarget.Global);
      const zen = fakeEditor('- [ ] Send 📅 2026-09-20 ⏫');
      decorations.update(zen.editor);
      const hints = [...zen.set.values()].map((ranges) => ranges.length).sort();
      assert.deepStrictEqual(hints, [0, 1, 1], 'the hint goes, the dimming and the color stay');
    } finally {
      await configuration.update('zenMode', undefined, vscode.ConfigurationTarget.Global);
      decorations.dispose();
    }
  });
});
