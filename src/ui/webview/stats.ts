import * as vscode from 'vscode';

import type { PreferenceServices } from '../../core/storage/preferences';
import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../core/workspace/indexReader';
import { NavigationService } from '../../services/navigationService';
import type { DeckardStatsSnapshot, StatsPageToHost } from '../protocol/stats';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import { StatsController } from './pages/stats/statsController';
import type { ThemePreview } from './themePreview';

/** What the Stats page is built from. */
export interface StatsPanelOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  /** The blob Stats counts from, and the visits it records. */
  preferences: Pick<PreferenceServices, 'reader' | 'usage'>;
  extensionUri: vscode.Uri;
  onOpenTag: (tagKey: string) => void | Promise<void>;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
}

/**
 * Provides an overview of indexed content and recorded local views. Each
 * most-viewed row opens the tag overview or note entry it counts.
 *
 * The page is `StatsController`, run by a `WebviewHost` in one panel; this
 * is the name the extension and its serializer know it by.
 */
export class StatsPanel implements vscode.Disposable {
  private readonly page: PanelAdapter<DeckardStatsSnapshot, StatsPageToHost>;

  /** Builds the page; nothing is shown until `show` or `restore`. */
  public constructor(options: StatsPanelOptions) {
    const controller = new StatsController({
      indexer: options.indexer,
      preferences: options.preferences,
      onOpenTag: options.onOpenTag,
      navigation: new NavigationService(),
      extensionUri: options.extensionUri,
    });
    this.page = new PanelAdapter(
      new WebviewHost(controller, { indexer: options.indexer, themePreview: options.themePreview }),
      { viewType: 'deckard.stats', title: 'Deckard Stats', extensionUri: options.extensionUri, icon: ['resources', 'deckard.svg'] },
    );
  }

  /** Opens Stats, or brings it to the front, and draws it once there are notes. */
  public show(): Promise<void> {
    return this.page.show();
  }

  /** Takes back the Stats panel VS Code kept across a reload. */
  public restore(panel: vscode.WebviewPanel): Promise<void> {
    return this.page.restore(panel);
  }

  /** Closes Stats, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }
}
