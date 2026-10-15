/**
 * What the Hubs view says of each hub since the reader last had its tag's
 * page open (docs/implementation/37-since-you-last-looked.md): how much is
 * new, as the page's band counts it, or when the page was last seen.
 *
 * Counting what is new reads the tag's page as a visit keeps it, which is a
 * search, so it is never done while the tree draws: the tree says when each
 * hub was seen, or what was counted for it last, and the hubs left to count
 * are counted after a pause, a few at a time, before the tree is drawn
 * again with them.
 */
import type { TagVisits } from '../../core/storage/tagVisits';
import type { WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import { Debouncer } from '../../shared/debounce';
import type { HubNews } from './hubTree';
import { captureTagPageState } from './searchPageState';
import { compareTagPage, describeHubSeen, isSinceShown, SINCE_AFTER_MS, TagChanges } from './sinceLastLooked';

/** How long the tree must stop asking before the hubs left are counted. */
export const HUB_NEWS_DELAY_MS = 300;

/** How long one turn of counting may run before it lets the window have the thread back. */
const TURN_MS = 30;

/** What the reader reads the tags' visits through: their times at once, each snapshot from storage. */
export type HubVisits = Pick<TagVisits, 'get' | 'seenAt' | 'hubSort'>;

/** What was counted for one hub: against which visit, in which index. */
interface Counted {
  seenAt: number;
  index: WorkspaceIndex;
  changes: TagChanges | undefined;
}

/**
 * Each hub's news for the Hubs view, counted off the draw. `news` answers
 * at once from what was counted; a hub whose page was seen over a day ago,
 * and that was not counted against this index and its last visit, is
 * counted after a pause, and `onReady` is called once the hubs asked for
 * are, so the view draws them. A count from an older index stands until
 * its own is ready, so a hub's count does not blink away at every save.
 */
export class HubNewsReader {
  private readonly counted = new Map<string, Counted>();
  /** The hubs asked for that are left to count. */
  private readonly wanted = new Set<string>();
  private readonly debouncer: Debouncer;
  private latest: { index: WorkspaceIndex; context: QueryContext } | undefined;
  private running: Promise<void> | undefined;
  private disposed = false;

  /** Reads `visits`, and calls `onReady` once the hubs asked for are counted. */
  public constructor(
    private readonly visits: HubVisits,
    private readonly onReady: () => void,
    delayMs = HUB_NEWS_DELAY_MS,
  ) {
    this.debouncer = new Debouncer(delayMs);
  }

  /** The news for the tree drawn now: what was counted, and when each hub was seen. */
  public news(index: WorkspaceIndex, context: QueryContext): HubNews {
    this.latest = { index, context };
    const seen = this.visits.seenAt();
    return {
      sort: this.visits.hubSort(),
      describe: (tagKey) => {
        const seenAt = seen.get(tagKey);
        const counted = this.counted.get(tagKey);
        const current = counted?.seenAt === seenAt ? counted : undefined;
        if (seenAt !== undefined && context.now - seenAt > SINCE_AFTER_MS && current?.index !== index) {
          this.wanted.add(tagKey);
          this.debouncer.schedule(() => void this.countWanted());
        }
        const changes = current?.changes;
        return {
          label: describeHubSeen(seenAt, changes, context),
          count: isSinceShown(changes, context.now) ? changes.total : 0,
        };
      },
    };
  }

  /** Stops counting; a count under way ends at its next turn. */
  public dispose(): void {
    this.disposed = true;
    this.debouncer.dispose();
  }

  /**
   * Counts the hubs asked for against the latest index, then calls
   * `onReady`. A run under way finishes first; the hubs asked for while it
   * ran are counted by this one.
   */
  private async countWanted(): Promise<void> {
    while (this.running) {
      await this.running;
    }
    if (this.disposed || this.wanted.size === 0 || !this.latest) {
      return;
    }
    this.running = this.countEach(this.latest.index, this.latest.context);
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
    if (!this.disposed) {
      this.onReady();
    }
  }

  /** Counts each wanted hub against `index`, letting the thread go between turns. */
  private async countEach(index: WorkspaceIndex, context: QueryContext): Promise<void> {
    let turnStart = Date.now();
    for (const tagKey of [...this.wanted]) {
      if (this.disposed) {
        return;
      }
      this.wanted.delete(tagKey);
      const seenAt = this.visits.seenAt().get(tagKey);
      if (seenAt === undefined) {
        continue;
      }
      const visit = await this.visits.get(tagKey);
      this.counted.set(tagKey, {
        seenAt,
        index,
        changes: visit ? compareTagPage(visit, captureTagPageState(index, tagKey, context)) : undefined,
      });
      if (Date.now() - turnStart > TURN_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        turnStart = Date.now();
      }
    }
  }
}
