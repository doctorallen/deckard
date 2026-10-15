import type { PinnedNote } from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import type { DashboardWidgetConfig } from '../../domain/model/preferences';
import { PINNED_NOTE_LIMIT, pinKey } from './preferencesSchema';

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
   * pin adds that widget, under the search, where a pin can be seen. Says
   * whether it added the widget.
   */
  public async pinNote(pin: PinnedNote): Promise<boolean> {
    const { pinnedNotes = [], dashboardWidgets } = this.repository.current;
    if (
      pinnedNotes.some((candidate) => pinKey(candidate) === pinKey(pin)) ||
      pinnedNotes.length >= PINNED_NOTE_LIMIT
    ) {
      return false;
    }
    const hasWidget = dashboardWidgets.some((widget) => widget.kind === 'pinnedNotes');
    await this.repository.update({
      pinnedNotes: [...pinnedNotes, pin],
      ...(hasWidget ? {} : { dashboardWidgets: withPinnedNotesWidget(dashboardWidgets) }),
    });
    return !hasWidget;
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
