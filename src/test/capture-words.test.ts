import * as assert from 'assert';

import { readCaptureText } from '../core/markdown/captureWords';
import { formatNoteLine } from '../ui/commands/capture';

suite('Capture reads its last words', () => {
  // Friday 2026-09-25, noon.
  const now = new Date(2026, 8, 25, 12).getTime();
  const read = (text: string) => readCaptureText(`- [ ] ${text}`, 'emoji', now);

  test('a day at the end is the due date, and leaves the sentence', () => {
    assert.strictEqual(read('Call Ren tomorrow').line, '- [ ] Call Ren 📅 2026-09-26');
    assert.strictEqual(read('Call Ren today').due, '2026-09-25');
    assert.strictEqual(read('Send the draft monday').line, '- [ ] Send the draft 📅 2026-09-28');
    assert.strictEqual(read('Send the draft next monday').due, '2026-09-28');
  });

  test('a short day, or a distance, needs a lead word', () => {
    assert.strictEqual(read('The cat sat').line, '- [ ] The cat sat', 'a sentence stays a sentence');
    assert.strictEqual(read('Pay rent due fri').line, '- [ ] Pay rent 📅 2026-10-02');
    assert.strictEqual(read('Book flights by +2w').due, '2026-10-09');
    assert.strictEqual(read('Renew the lease in 3 days').line, '- [ ] Renew the lease 📅 2026-09-28');
    assert.strictEqual(read('Ship +2w').due, undefined, 'a bare distance needs its lead word');
    assert.strictEqual(read('Ship by 2026-10-02').due, '2026-10-02');
  });

  test('a week, a month end, or a month and day, and a numeric date after a lead word', () => {
    assert.strictEqual(read('Call Ren next week').line, '- [ ] Call Ren 📅 2026-09-28');
    assert.strictEqual(read('Pay rent end of the month').due, '2026-09-30');
    assert.strictEqual(read('Dinner oct 3').due, '2026-10-03');
    const mdy = (text: string) =>
      readCaptureText(`- [ ] ${text}`, 'emoji', now, { numericOrder: 'mdy' });
    assert.strictEqual(mdy('Ship by 10/3').due, '2026-10-03');
    assert.strictEqual(mdy('Ship 10/3').line, '- [ ] Ship 10/3', 'a numeric date needs its lead word');
    assert.strictEqual(read('plan the weekend').line, '- [ ] plan the weekend');
    assert.strictEqual(read('Read chapter 3').line, '- [ ] Read chapter 3');
  });

  test('priority and a repeat rule, in any order with the day', () => {
    const reading = read('Water plants every week p2 friday');
    assert.strictEqual(reading.priority, 'high');
    assert.strictEqual(reading.recurrence, 'every week');
    assert.strictEqual(reading.due, '2026-10-02');
    assert.strictEqual(reading.line, '- [ ] Water plants ⏫ 🔁 every week 📅 2026-10-02');
    assert.strictEqual(read('Ship it !!!').priority, 'highest');
    assert.strictEqual(read('Stand-up daily').recurrence, 'every day');
  });

  test('a capture with nothing to read is written exactly as typed', () => {
    assert.strictEqual(read('Plan the offsite').line, '- [ ] Plan the offsite');
    assert.strictEqual(read('tomorrow').line, '- [ ] tomorrow', 'a day alone is the whole task');
  });

  test('a note line is a plain list item', () => {
    assert.strictEqual(formatNoteLine('An idea about #project/atlas'), '- An idea about #project/atlas');
    assert.strictEqual(formatNoteLine('- [ ] Not a task'), '- Not a task');
  });
});
