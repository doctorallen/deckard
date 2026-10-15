/**
 * What the Hubs view says of each hub since the reader last had its tag's
 * page open (docs/implementation/37-since-you-last-looked.md): how much is
 * new, as the page's band counts it, or when the page was last seen.
 */
import type { TagVisits } from '../../core/storage/tagVisits';
import type { WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import type { HubNews } from './hubTree';
import { captureTagPageState } from './searchPageState';
import { compareTagPage, describeHubSeen, isSinceShown, SINCE_AFTER_MS } from './sinceLastLooked';

/**
 * Each hub's news from the tags' visits. A hub whose page was seen within
 * the day has nothing new, as its band would show nothing, so only the
 * others' pages are read.
 */
export function createHubNews(
  index: WorkspaceIndex,
  visits: Pick<TagVisits, 'get' | 'seenAt' | 'hubSort'>,
  context: QueryContext,
): HubNews {
  const seen = visits.seenAt();
  return {
    sort: visits.hubSort(),
    describe: (tagKey) => {
      const seenAt = seen.get(tagKey);
      const visit = seenAt !== undefined && context.now - seenAt > SINCE_AFTER_MS ? visits.get(tagKey) : undefined;
      const changes = visit ? compareTagPage(visit, captureTagPageState(index, tagKey, context)) : undefined;
      return {
        label: describeHubSeen(seenAt, changes, context),
        count: isSinceShown(changes, context.now) ? changes.total : 0,
      };
    },
  };
}
