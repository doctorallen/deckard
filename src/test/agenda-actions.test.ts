import * as assert from 'assert';

import { dueDateFor } from '../ui/commands/agendaActions';

suite('Dating tasks from the Tasks view', () => {
  test('names a date the way the menu does', () => {
    // Friday 2026-09-25, noon.
    const friday = new Date(2026, 8, 25, 12).getTime();
    assert.strictEqual(dueDateFor('today', friday), '2026-09-25');
    assert.strictEqual(dueDateFor('tomorrow', friday), '2026-09-26');
    assert.strictEqual(dueDateFor('nextWeek', friday), '2026-09-28', 'next week is its Monday');
    const monday = new Date(2026, 8, 28, 9).getTime();
    assert.strictEqual(dueDateFor('nextWeek', monday), '2026-10-05', 'on a Monday, the one after');
  });
});
