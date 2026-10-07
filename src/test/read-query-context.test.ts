import * as assert from 'assert';
import * as vscode from 'vscode';

import { readQueryContext } from '../ui/commands/queryContext';

/**
 * readQueryContext reads, from settings, what a search's answer depends on.
 * A search reads a tag written with a namespace alias through the aliases in
 * its context, so they must be the ones the index was built with.
 */
suite('The QueryContext read from settings', () => {
  const configuration = () => vscode.workspace.getConfiguration('deckard');
  const write = (value: unknown) =>
    configuration().update('entityNamespaceAliases', value, vscode.ConfigurationTarget.Global);

  teardown(() => write(undefined));

  test("carries the workspace's own namespace aliases over the built-in ones", async () => {
    await write({ proj: 'project' });
    const aliases = readQueryContext(0).entityNamespaceAliases;
    assert.strictEqual(aliases.proj, 'project');
    assert.strictEqual(aliases.organization, 'org');
  });

  test('carries the reader\'s date formats, an empty one at its default', async () => {
    await configuration().update('display.dateFormat', 'DD/MM/YYYY', vscode.ConfigurationTarget.Global);
    await configuration().update('display.shortDateFormat', ' ', vscode.ConfigurationTarget.Global);
    try {
      const { dateFormats } = readQueryContext(0);
      assert.strictEqual(dateFormats.date, 'DD/MM/YYYY');
      assert.strictEqual(dateFormats.short, 'ddd, MMM D');
    } finally {
      await configuration().update('display.dateFormat', undefined, vscode.ConfigurationTarget.Global);
      await configuration().update('display.shortDateFormat', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
