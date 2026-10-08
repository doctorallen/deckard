import * as vscode from 'vscode';

import type { IndexControl, IndexReader, IndexScanStatus, IndexUpdates } from '../../core/workspace/indexReader';
import { NavigationService } from '../../services/navigationService';
import type { DashboardPageState, DashboardPageToHost } from '../protocol/dashboard';
import type { TaskWrites } from '../commands/taskActions';
import type { TryNextLedger } from '../commands/tryNext';
import type { WhatsNew } from '../commands/whatsNew';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import {
  DashboardController,
  DashboardNavigation,
  DashboardPreferences,
} from './pages/dashboard/dashboardController';
import type { ThemePreview } from './themePreview';

/** What Home is built from. */
export interface DashboardPanelOptions {
  indexer: IndexReader & IndexScanStatus & IndexUpdates & IndexControl;
  preferences: DashboardPreferences;
  extensionUri: vscode.Uri;
  navigation: DashboardNavigation;
  /** Whether Home says Deckard was updated; absent, it never does. */
  whatsNew?: Pick<WhatsNew, 'pending' | 'clear' | 'onDidChange'>;
  /** What Try next has been told; absent, it suggests nothing. */
  tryNext?: Pick<TryNextLedger, 'retired' | 'snoozed' | 'retire' | 'snooze' | 'onDidChange'>;
  /** What checking a task off, or renaming a tag, writes through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
}

/**
 * Home and the Tags tab, in one panel: the name the extension and its
 * serializer know the Dashboard by.
 *
 * The page is `DashboardController`, run by a `WebviewHost` in a
 * `PanelAdapter`.
 */
export class DashboardPanel implements vscode.Disposable {
  private readonly controller: DashboardController;
  private readonly host: WebviewHost<DashboardPageState, DashboardPageToHost>;
  private readonly page: PanelAdapter<DashboardPageState, DashboardPageToHost>;
  private readonly indexer: DashboardPanelOptions['indexer'];

  /** Builds the page and starts following what it draws from; nothing is shown until `show` or `restore`. */
  public constructor(options: DashboardPanelOptions) {
    this.indexer = options.indexer;
    this.controller = new DashboardController({
      indexer: options.indexer,
      preferences: options.preferences,
      extensionUri: options.extensionUri,
      navigation: options.navigation,
      whatsNew: options.whatsNew,
      tryNext: options.tryNext,
      writes: options.writes,
      navigationService: new NavigationService(),
    });
    this.host = new WebviewHost(this.controller, { indexer: options.indexer, themePreview: options.themePreview });
    this.page = new PanelAdapter(this.host, {
      viewType: 'deckard.dashboard',
      title: 'Deckard Dashboard',
      extensionUri: options.extensionUri,
      icon: ['resources', 'deckard.svg'],
    });
  }

  /**
   * Reveals or creates the dashboard, waiting for the initial index first.
   */
  public show(): Promise<void> {
    return this.page.show();
  }

  /**
   * Opens a saved view where it was saved: on the Task Board, or on a search
   * page with its query, or its tags that still exist joined by AND.
   */
  public openSavedFilter(filterId: string): Promise<void> {
    return this.controller.openSavedFilter(filterId);
  }

  /**
   * Opens the dashboard for `deckard.dashboard.openOnStartup`.
   *
   * Waiting for the first index gives VS Code time to restore a dashboard from
   * the last session, which is left as it is rather than opened twice, and
   * shows whether the workspace has any notes worth opening it for.
   */
  public async showOnStartup(): Promise<void> {
    await this.host.whenPublished();
    if (!this.page.panel && this.indexer.getSnapshot().files.size > 0) {
      await this.show();
    }
  }

  /**
   * Reattaches a serialized panel without creating a duplicate dashboard.
   */
  public restore(panel: vscode.WebviewPanel): Promise<void> {
    return this.page.restore(panel);
  }

  /** Closes the dashboard, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }
}
