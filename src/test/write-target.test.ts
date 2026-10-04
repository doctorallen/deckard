import * as assert from 'assert';

import { writeNeedsAsking } from '../ui/commands/writeTarget';
import { describeScope } from '../ui/views/scopeStatusBar';

suite('Where Deckard may write', () => {
  test('asks only before writing at the top of a code repository nobody chose a notes folder for', () => {
    const risky = { paused: false, notesFolder: '', confirmed: false, codeRepository: true };
    assert.strictEqual(writeNeedsAsking(risky), true);
    assert.strictEqual(writeNeedsAsking({ ...risky, notesFolder: 'notes' }), false);
    assert.strictEqual(writeNeedsAsking({ ...risky, confirmed: true }), false);
    assert.strictEqual(writeNeedsAsking({ ...risky, codeRepository: false }), false);
    assert.strictEqual(writeNeedsAsking({ ...risky, paused: true }), false);
  });

  test('the status bar speaks only while paused, or while a repository is read whole and not kept', () => {
    assert.strictEqual(describeScope({ paused: false, kept: false }), undefined);
    assert.strictEqual(describeScope({ paused: false, wholeRepository: 'api', kept: true }), undefined);
    assert.deepStrictEqual(
      [describeScope({ paused: true, kept: false })?.text, describeScope({ paused: true, kept: false })?.command],
      ['$(debug-pause) Deckard paused', 'deckard.resumeHere'],
    );
    const whole = describeScope({ paused: false, wholeRepository: 'api', kept: false });
    assert.strictEqual(whole?.command, 'deckard.chooseScope');
    assert.match(whole?.tooltip ?? '', /every Markdown file in api, READMEs and docs included/);
  });
});
