import * as assert from 'assert';

import { needsIdentity } from '../ui/commands/identityPrompt';

suite('Asking who you are', () => {
  test('only a search about you, while no one is named as you', () => {
    assert.strictEqual(needsIdentity('is:mine AND is:open', ''), true);
    assert.strictEqual(needsIdentity('IS:WAITING', undefined), true);
    assert.strictEqual(needsIdentity('is:me', '  '), true);
    assert.strictEqual(needsIdentity('is:mine', '@dana'), false);
    assert.strictEqual(needsIdentity('#project/atlas is:open', ''), false);
    assert.strictEqual(needsIdentity('text ~ "is:mineral"', ''), false);
  });
});
