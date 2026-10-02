import * as assert from 'assert';

import { excludeHubLinks } from '../../ui/webview/pages/searchPage/searchPageController';
import { activateDeckard, arrange, arrangementsOf, clearEverywhere, deckard, decidingLevel, isMultiRoot, levels } from './scopes';

/**
 * A tag page's Leave Them Out turns `deckard.tagOverview.includeHubLinks`
 * off where the value in force is set, so the page stops listing the
 * entries that only link the hub note in a workspace that sets it too.
 */
suite(`A tag page leaving out hub links, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  teardown(() => clearEverywhere('tagOverview.includeHubLinks'));

  for (const arrangement of arrangementsOf(true, false)) {
    test(`${arrangement.name}: Leave Them Out turns them off`, async () => {
      await arrange('tagOverview.includeHubLinks', arrangement);
      const level = decidingLevel('tagOverview.includeHubLinks');

      assert.strictEqual(await excludeHubLinks(), true);

      assert.strictEqual(deckard().get('tagOverview.includeHubLinks'), false, 'the window reads them as left out');
      assert.strictEqual(
        levels('tagOverview.includeHubLinks')[level],
        false,
        `written in the ${level} settings, ${JSON.stringify(levels('tagOverview.includeHubLinks'))}`,
      );
    });
  }
});
