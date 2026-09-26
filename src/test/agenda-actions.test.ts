import * as assert from 'assert';

import * as vscode from 'vscode';

import { dueDateFor } from '../ui/commands/agendaActions';
import { validateDateInput } from '../ui/commands/datePrompt';

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

  test('a date box says back the day it read, or the one error', () => {
    const friday = new Date(2026, 8, 25, 12).getTime();
    assert.deepStrictEqual(validateDateInput('monday', friday), {
      message: 'Monday 2026-09-28 · in 3 days',
      severity: vscode.InputBoxValidationSeverity.Info,
    });
    assert.strictEqual(
      validateDateInput('blah', friday),
      'Enter a date such as friday, in 3 days, or 2026-10-02.',
    );
  });
});
