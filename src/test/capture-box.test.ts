import * as assert from 'assert';

import { CaptureBox, CaptureBoxOptions } from '../ui/commands/captureBox';

/** A box with no tags, and a preview that says what it was asked for. */
function box(options: Partial<CaptureBoxOptions> = {}): CaptureBox {
  return new CaptureBox({
    initialTarget: 'today',
    tags: [{ label: '#project/atlas', count: 3 }],
    personMarker: '@',
    preview: (text, literal, link) => `- [ ] ${text}${literal ? ' (as typed)' : ' (read)'}${link ? ` ${link}` : ''}`,
    ...options,
  });
}

suite('The Capture box', () => {
  test('opens empty on today, with the reading and heading buttons', () => {
    const empty = box();
    assert.strictEqual(empty.initialValue, undefined);
    assert.strictEqual(empty.title(), 'Deckard: Capture');
    assert.deepStrictEqual(empty.buttons(), ['literal', 'heading']);
    assert.deepStrictEqual(empty.items(''), []);
    assert.strictEqual(box({ initialTarget: 'heading' }).title(), 'Deckard: Capture Under a Heading');
  });

  test('the first row adds the words, shows how they will read, and the second writes a note line', () => {
    const rows = box().items('Call Ren #pro');
    assert.deepStrictEqual(rows, [
      {
        label: 'Call Ren #pro',
        description: "Add to today's note",
        detail: '- [ ] Call Ren #pro (read)',
        alwaysShow: true,
        action: 'add',
      },
      { label: 'Add as a note line', description: '- Call Ren #pro', alwaysShow: true, action: 'note' },
      { label: '#project/atlas', description: 'Complete the tag', alwaysShow: true, action: 'tag' },
    ]);
  });

  test('a line that reads as typed shows no second line under the words', () => {
    const plain = box({ preview: (text) => `- [ ] ${text}` });
    assert.strictEqual(plain.items('Call Ren')[0].detail, undefined);
  });

  test('a restored draft opens in the box, says so until the first keystroke, and keeps its reading', () => {
    const restored = box({ draft: { text: 'Call Ren friday', target: 'today', literal: true } });
    assert.strictEqual(restored.initialValue, 'Call Ren friday');
    assert.strictEqual(restored.title(), 'Deckard: Capture — Restored what you were typing');
    assert.deepStrictEqual(restored.buttons(), ['reading', 'heading']);
    restored.typed();
    assert.strictEqual(restored.title(), 'Deckard: Capture');
  });

  test('a selection wins over the draft, which waits as a row until it is chosen', () => {
    const seeded = box({
      seed: { text: 'Budget', link: '[[Atlas#Budget]]' },
      draft: { text: 'Call Ren friday', target: 'today', literal: true },
    });
    assert.strictEqual(seeded.initialValue, 'Budget');
    assert.deepStrictEqual(seeded.buttons(), ['unlink', 'literal', 'heading']);
    const rows = seeded.items('Budget');
    assert.strictEqual(rows[0].detail, '- [ ] Budget (read) [[Atlas#Budget]]');
    assert.deepStrictEqual(rows[1], {
      label: 'Restore what you were typing',
      description: 'Call Ren friday',
      alwaysShow: true,
      action: 'restore',
    });

    assert.deepStrictEqual(seeded.accept('Budget', 'restore'), { kind: 'replace', value: 'Call Ren friday' });
    assert.deepStrictEqual(seeded.buttons(), ['reading', 'heading'], 'the draft had no link, and kept its words');
    assert.ok(!seeded.items('Call Ren friday').some((row) => row.action === 'restore'));
  });

  test('the buttons toggle the link, the reading, and where the words go', () => {
    const seeded = box({ seed: { text: 'Budget', link: '[[Atlas]]' } });
    seeded.press('unlink');
    assert.deepStrictEqual(seeded.buttons(), ['link', 'literal', 'heading']);
    assert.strictEqual(seeded.items('Budget')[0].detail, '- [ ] Budget (read)');
    seeded.press('literal');
    seeded.press('heading');
    assert.deepStrictEqual(seeded.buttons(), ['link', 'reading', 'today']);
    assert.strictEqual(seeded.title(), 'Deckard: Capture Under a Heading');
    assert.strictEqual(seeded.items('Budget')[0].description, 'Choose a heading next');
  });

  test('choosing a tag completes the word; Enter answers with the words, kept as a draft', () => {
    const typing = box({ seed: { text: 'Budget', link: '[[Atlas]]' } });
    assert.deepStrictEqual(typing.accept('Call #pro', 'tag', '#project/atlas'), {
      kind: 'replace',
      value: 'Call #project/atlas ',
    });
    assert.deepStrictEqual(typing.accept('   ', 'add'), { kind: 'none' });
    assert.deepStrictEqual(typing.accept(' Budget review ', 'note'), {
      kind: 'answer',
      answer: { text: 'Budget review', target: 'today', literal: false, asNote: true, link: '[[Atlas]]' },
      draft: { text: 'Budget review', target: 'today', literal: false },
    });
    assert.deepStrictEqual(typing.hide('Budget review'), { kind: 'leave' }, 'accepted words are written, not kept');
  });

  test('closing keeps typed words as a draft, empties it, or leaves a selection alone', () => {
    assert.deepStrictEqual(box().hide(' Call Ren '), {
      kind: 'save',
      draft: { text: 'Call Ren', target: 'today', literal: false },
    });
    assert.deepStrictEqual(box().hide('  '), { kind: 'clear' });
    const seeded = box({ seed: { text: 'Budget' } });
    assert.deepStrictEqual(seeded.hide('Budget'), { kind: 'leave' }, 'the selection as it was is not a draft');
    assert.strictEqual(seeded.hide('Budget review').kind, 'save');
  });
});
