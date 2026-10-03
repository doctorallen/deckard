import type {
  DashboardMode,
  DashboardSearchField,
  DashboardViewState,
  DashboardWidgetConfig,
} from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import {
  cloneWidgets,
  DEFAULT_DASHBOARD_WIDGETS,
  normalizeDashboardViewState,
  normalizeDashboardWidgets,
} from './preferencesSchema';

/** Which view-state field each Dashboard search box fills. */
const SEARCH_FIELDS: Record<DashboardSearchField, keyof DashboardViewState> = {
  tags: 'tagSearchQuery',
};

/**
 * Home's widgets as the reader arranged them, and which Dashboard tab was
 * left open with what its filter held. A widget is a deliberate choice:
 * pruning never removes one.
 */
export class HomeWidgetsService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Replaces Home's widgets. Widgets the store cannot use are dropped, as
   * they are when read back.
   */
  public async setDashboardWidgets(
    dashboardWidgets: readonly DashboardWidgetConfig[],
  ): Promise<void> {
    await this.repository.update({
      dashboardWidgets: normalizeDashboardWidgets(dashboardWidgets),
    });
  }

  /**
   * Adds a Home widget listing what a saved search finds, unless Home
   * already has one for it. Says which, or that there is no such search.
   */
  public async addSavedSearchWidget(filterId: string): Promise<'added' | 'present' | 'missing'> {
    const current = this.repository.current;
    if (!current.savedFilters.some((filter) => filter.id === filterId)) {
      return 'missing';
    }
    const widgets = current.dashboardWidgets;
    if (widgets.some((widget) => widget.kind === 'savedQuery' && widget.filterId === filterId)) {
      return 'present';
    }
    await this.setDashboardWidgets([
      ...widgets,
      {
        id: `savedQuery-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind: 'savedQuery',
        width: 'half',
        count: 5,
        filterId,
      },
    ]);
    return 'added';
  }

  /** Puts back the widgets Home starts with. */
  public async resetDashboardWidgets(): Promise<void> {
    await this.repository.update({ dashboardWidgets: cloneWidgets(DEFAULT_DASHBOARD_WIDGETS) });
  }

  /** Remembers which Dashboard tab was open, so it reopens there. */
  public async setDashboardMode(mode: DashboardMode): Promise<void> {
    await this.updateDashboardViewState({ mode });
  }

  /** Remembers what a Dashboard search box held, so it reopens filtered. */
  public async setDashboardSearch(
    field: DashboardSearchField,
    query: string,
  ): Promise<void> {
    await this.updateDashboardViewState({ [SEARCH_FIELDS[field]]: query });
  }

  /** Lays changes over the Dashboard's view state and keeps what is valid of it. */
  private async updateDashboardViewState(
    changes: Partial<DashboardViewState>,
  ): Promise<void> {
    await this.repository.update({
      dashboardViewState: normalizeDashboardViewState({
        ...this.repository.current.dashboardViewState,
        ...changes,
      }),
    });
  }
}
