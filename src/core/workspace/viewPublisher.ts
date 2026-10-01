import type { Disposable, Event } from '../../ports/events';
import { Emitter } from '../../shared/emitter';
import { measure, reportError } from '../../shared/timing';
import type { WorkspaceIndex } from '../types';
import type { IndexUpdates } from './indexReader';
import type { ViewUpdateOptions } from './publishing';

/** A view waiting for its turn to redraw from the index. */
interface ViewSubscription {
  listener: () => void;
  options: ViewUpdateOptions;
  disposed: boolean;
}

/**
 * Publishes each new index: at once to the plain listeners, then to each
 * view in a host turn of its own, the one in front first.
 *
 * A save used to redraw every open view in one turn, so the view in front
 * waited on the ones behind it, and so did every other extension. Here no
 * single turn pays for every open view. A publish while views are still
 * waiting starts the order again, and each waiting view still runs once.
 */
export class ViewPublisher implements IndexUpdates, Disposable {
  private readonly updateEmitter = new Emitter<WorkspaceIndex>();
  /** Fires with each published index, for listeners that only keep it or fire a cheap event. */
  public readonly onDidUpdate: Event<WorkspaceIndex> = this.updateEmitter.event;
  /** Views that redraw in turns of their own, in the order they asked. */
  private readonly views = new Set<ViewSubscription>();
  /** The views still to redraw from the last publish, next first. */
  private viewQueue: ViewSubscription[] = [];
  private viewTurnScheduled = false;
  private disposed = false;
  private readonly publishedPromise: Promise<void>;
  private resolvePublished: () => void = () => undefined;

  /**
   * `schedule` runs a view's redraw in a later host turn: `setImmediate` by
   * default; a test passes its own to step through the turns.
   */
  public constructor(
    private readonly schedule: (run: () => void) => void = (run) => void setImmediate(run),
  ) {
    this.publishedPromise = new Promise<void>((resolve) => {
      this.resolvePublished = resolve;
    });
  }

  /** Resolves at the first publish, and stays resolved. */
  public get published(): Promise<void> {
    return this.publishedPromise;
  }

  /**
   * Redraws a view from the index after each update, in a host turn of its
   * own, after the plain listeners and in order of `priority` (the view in
   * front first). A view that has not had its turn when the index changes
   * again runs once, with the newer index.
   */
  public onDidUpdateView(
    listener: () => void,
    options: ViewUpdateOptions,
  ): Disposable {
    const subscription: ViewSubscription = { listener, options, disposed: false };
    this.views.add(subscription);
    return {
      dispose: () => {
        subscription.disposed = true;
        this.views.delete(subscription);
      },
    };
  }

  /**
   * Publishes the index `snapshot` gives, which it calls once, inside the
   * timing of the plain listeners, so an index derived lazily is timed with
   * them. Then orders the views by the priority each gives now and starts
   * their turns.
   */
  public publish(snapshot: () => WorkspaceIndex): void {
    this.resolvePublished();
    measure('Refresh views after an index update', () =>
      this.updateEmitter.fire(snapshot()),
    );
    this.viewQueue = [...this.views]
      .map((subscription, order) => ({
        subscription,
        order,
        priority: readPriority(subscription),
      }))
      .sort((left, right) => left.priority - right.priority || left.order - right.order)
      .map(({ subscription }) => subscription);
    this.scheduleViewTurn();
  }

  /** Drops every listener and waiting view, so a turn already scheduled does nothing. */
  public dispose(): void {
    this.disposed = true;
    this.updateEmitter.dispose();
    this.views.clear();
    this.viewQueue = [];
  }

  /** Asks for the next view's turn, unless one is already asked for or none is waiting. */
  private scheduleViewTurn(): void {
    if (this.viewTurnScheduled || this.viewQueue.length === 0) {
      return;
    }
    this.viewTurnScheduled = true;
    this.schedule(() => {
      this.viewTurnScheduled = false;
      this.runNextView();
    });
  }

  /** Redraws the next view waiting, if any, then leaves the rest a turn. */
  private runNextView(): void {
    if (this.disposed) {
      return;
    }
    let next = this.viewQueue.shift();
    while (next?.disposed) {
      next = this.viewQueue.shift();
    }
    if (next) {
      const view = next;
      try {
        measure(`Refresh ${view.options.name} after an index update`, () =>
          view.listener(),
        );
      } catch (error) {
        reportError(`Could not refresh ${view.options.name}`, error);
      }
    }
    this.scheduleViewTurn();
  }
}

/** A view's priority now, or last when it cannot say. */
function readPriority(subscription: ViewSubscription): number {
  try {
    const priority = subscription.options.priority();
    return Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
