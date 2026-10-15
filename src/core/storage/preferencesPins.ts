import type { PinnedNote } from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import type { DashboardWidgetConfig } from '../../domain/model/preferences';
import { HOME_WIDGET_LIMIT } from '../../domain/dashboard/widgetCatalog';
import { PINNED_NOTE_LIMIT, pinKey } from './preferencesSchema';

/**
 * What a pin did to Home's widgets: added its Pinned notes widget, found
 * Home too full to add it, or left the widgets as they were.
 */
export type PinWidgetChange = 'added' | 'homeFull' | 'none';

/**
 * The notes and headings pinned to Home, in the order they were pinned and
 * told apart by `pinKey`. A pin is a deliberate choice: pruning never
 * removes one.
 */
export class PinsService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Pins a note to Home, after the notes pinned before it. Home lists pins
   * in its Pinned notes widget, which it does not start with, so the first
   * pin adds that widget, under the search, where a pin can be seen, unless
   * Home already holds as many widgets as it may: adding one then would
   * push its last widget off. Says which.
   */
  public async pinNote(pin: PinnedNote): Promise<PinWidgetChange> {
    const { pinnedNotes = [], dashboardWidgets } = this.repository.current;
    if (
      pinnedNotes.some((candidate) => pinKey(candidate) === pinKey(pin)) ||
      pinnedNotes.length >= PINNED_NOTE_LIMIT
    ) {
      return 'none';
    }
    const change = readWidgetChange(dashboardWidgets);
    await this.repository.update({
      pinnedNotes: [...pinnedNotes, pin],
      ...(change === 'added' ? { dashboardWidgets: withPinnedNotesWidget(dashboardWidgets) } : {}),
    });
    return change;
  }

  /** Unpins the pin a row names, by the key `pinKey` writes for it. */
  public async unpinNote(key: string): Promise<void> {
    await this.repository.update({
      pinnedNotes: (this.repository.current.pinnedNotes ?? []).filter(
        (candidate) => pinKey(candidate) !== key,
      ),
    });
  }

  /** Whether something is already pinned, by its key. */
  public isPinned(key: string): boolean {
    return (this.repository.current.pinnedNotes ?? []).some(
      (candidate) => pinKey(candidate) === key,
    );
  }
}

/** What the first pin does to Home's widgets: nothing once it has Pinned notes, and nothing while it is full. */
function readWidgetChange(widgets: readonly DashboardWidgetConfig[]): PinWidgetChange {
  if (widgets.some((widget) => widget.kind === 'pinnedNotes')) {
    return 'none';
  }
  return widgets.length >= HOME_WIDGET_LIMIT ? 'homeFull' : 'added';
}

/**
 * Home's widgets with a Pinned notes widget added after the search, or
 * first when Home has no search.
 */
function withPinnedNotesWidget(
  widgets: readonly DashboardWidgetConfig[],
): DashboardWidgetConfig[] {
  const pinned: DashboardWidgetConfig = { id: 'pinnedNotes', kind: 'pinnedNotes', width: 'half', count: 5 };
  const at = widgets.findIndex((widget) => widget.kind === 'search') + 1;
  return [...widgets.slice(0, at), pinned, ...widgets.slice(at)];
}
