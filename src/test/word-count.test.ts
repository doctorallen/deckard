import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  countNoteWords,
  countWords,
  describeWordCount,
  maskNoteForWords,
} from '../core/markdown/wordCount';
import { WordCountStatusBar } from '../ui/views/wordCountStatusBar';

function count(...lines: string[]): number {
  return countNoteWords(maskNoteForWords(lines));
}

suite('Word count', () => {
  test('counts the words of prose', () => {
    assert.strictEqual(countWords('Send the proposal, then call Ren.'), 6);
    assert.strictEqual(count('# Plan for the week', '', 'Two words'), 6);
  });

  test('leaves out front matter, code, comments, and addresses', () => {
    assert.strictEqual(count('---', 'title: Not these', '---', 'Only these'), 2);
    assert.strictEqual(count('One', '```', 'code words here', '```', 'Two'), 2);
    assert.strictEqual(count('Some `inline code here` stays'), 2);
    assert.strictEqual(count('Seen <!-- not', 'seen --> again'), 2);
    assert.strictEqual(count('Read [the guide](https://example.com/very/long) now'), 4);
    assert.strictEqual(count('Text', '', '    indented code words', '', 'More'), 2);
    assert.strictEqual(count('- a list', '    nested list words'), 5, 'a nested list is not code');
  });

  test('counts a link\'s alias, or its target when it has none', () => {
    assert.strictEqual(count('See [[Atlas Plan|the atlas]] and [[Orion]]'), 5);
  });

  test('leaves out task metadata, the checkbox, and block ids', () => {
    assert.strictEqual(count('- [x] Send the proposal 📅 2026-09-20 ⏫ 🔁 every week ✅ 2026-09-21 ^abc'), 3);
    assert.strictEqual(count('A line ^abc'), 2);
  });

  test('counts only a selection\'s words when there is one', () => {
    const masked = maskNoteForWords(['One two three four', 'five six']);
    assert.strictEqual(
      countNoteWords(masked, [{ start: { line: 0, character: 4 }, end: { line: 1, character: 4 } }]),
      4,
    );
  });

  test('says the count, the minutes, and the selection', () => {
    assert.strictEqual(describeWordCount(412).text, '412 words · 2 min');
    assert.strictEqual(describeWordCount(1204).text, '1,204 words · 5 min');
    assert.strictEqual(describeWordCount(0).text, '0 words');
    assert.deepStrictEqual(describeWordCount(412, 38), {
      text: '38 of 412 words',
      tooltip: '38 words selected, of 412 in this note.',
    });
    assert.strictEqual(
      describeWordCount(412).tooltip,
      '412 words in this note, about 2 minutes to read at 238 words a minute. Front matter, code, and task metadata are not counted.',
    );
  });

  test('shows in a note and hides elsewhere', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: 'Three small words' });
    const editor = await vscode.window.showTextDocument(document);
    let isNote = true;
    const bar = new WordCountStatusBar(() => isNote);
    try {
      bar.update(editor);
      assert.strictEqual(bar.shown?.text, '3 words · 1 min');
      editor.selection = new vscode.Selection(0, 0, 0, 5);
      bar.update(editor);
      assert.strictEqual(bar.shown?.text, '1 of 3 words');
      isNote = false;
      bar.update(editor);
      assert.strictEqual(bar.shown, undefined);
    } finally {
      bar.dispose();
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
