// End-to-end: tag decorations in the editor, against the real provider.
//
// Typing changes the document on every keystroke. Decorations wait for the
// typing to pause and then redraw once, rather than reparsing the note per
// keystroke.
const assert = require('assert');
const vscode = require('vscode');
const { EditorTagDecorations } = require('../../out/ui/commands/tagDecorations.js');

/** A visible editor that records how many decorations each draw sets. */
function createEditor(path, text) {
  const lines = text.split('\n');
  const draws = [];
  const editor = {
    document: {
      uri: vscode.Uri.file(path),
      languageId: 'markdown',
      get lineCount() {
        return lines.length;
      },
      getText: () => lines.join('\n'),
      lineAt: (line) => ({ text: lines[line] ?? '' }),
    },
    setDecorations: (_type, decorations) => draws.push(decorations.length),
  };
  return { editor, draws };
}

const settle = (milliseconds = 250) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** One keystroke's worth of document change. */
const type = (document) =>
  vscode._test.emitters.textDocument.fire({ document, contentChanges: [{ text: 'x' }] });

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('a burst of edits redraws tags once, after typing pauses', async () => {
  const { editor, draws } = createEditor(
    '/notes/plan.md',
    '# Plan #project/atlas\nText with #risk/vendor.',
  );
  vscode.window.visibleTextEditors = [editor];
  const decorations = new EditorTagDecorations();
  try {
    const firstDraw = draws.length;
    assert.ok(firstDraw > 0, 'a visible note is drawn when the provider starts');
    assert.ok(draws.includes(2), 'both tags are decorated');

    for (let keystroke = 0; keystroke < 5; keystroke += 1) {
      type(editor.document);
    }
    assert.strictEqual(draws.length, firstDraw, 'nothing is redrawn while typing');

    await settle();
    assert.strictEqual(draws.length, firstDraw * 2, 'one redraw once typing pauses');
  } finally {
    decorations.dispose();
    vscode.window.visibleTextEditors = [];
  }
});

test('edits to a file that is not Markdown redraw nothing', async () => {
  const { editor, draws } = createEditor('/notes/plan.txt', '#project/atlas');
  vscode.window.visibleTextEditors = [editor];
  const decorations = new EditorTagDecorations();
  try {
    const firstDraw = draws.length;
    type(editor.document);
    await settle();
    assert.strictEqual(draws.length, firstDraw);
  } finally {
    decorations.dispose();
    vscode.window.visibleTextEditors = [];
  }
});

// ---------------------------------------------------------------------------

(async () => {
  let pass = 0;
  const failures = [];
  for (const entry of tests) {
    try {
      await entry.fn();
      pass += 1;
      console.log('  ok   ' + entry.name);
    } catch (error) {
      failures.push(entry.name + '\n       ' + String(error.message).split('\n')[0]);
      console.log('  FAIL ' + entry.name);
    }
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(failures.length ? 1 : 0);
})();
