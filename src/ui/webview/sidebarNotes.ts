import * as vscode from 'vscode';

import type { SidebarGraphContext } from '../../core/types';
import { NavigationService } from '../../services/navigationService';
import type { SidebarNotesPageState, SidebarNotesPageToHost } from '../protocol/sidebarNotes';
import { ViewSurface } from './host/surface';
import { WebviewHost } from './host/webviewHost';
import {
  EntryRelatedNotesDiagnostic,
  logRelatedNotes,
  SidebarNotesController,
  SidebarNotesControllerOptions,
} from './pages/sidebarNotes/sidebarNotesController';

export { createEntryScope, findTaggedEntry } from '../state/entryScope';
export type { EntryScope, EntryTagContext, EntryTagSource } from '../state/entryScope';
export { findMatchingEntryLine } from './pages/sidebarNotes/sidebarNotesController';
export type { EntryRelatedNotesDiagnostic, SidebarNotesPreferences } from './pages/sidebarNotes/sidebarNotesController';

/** What Related Notes is built from. */
export type SidebarNotesViewOptions = Omit<SidebarNotesControllerOptions, 'navigation'>;

/**
 * Shows the notes related to the Markdown note being edited, or, while a
 * search page is the active editor, that search's Refine options, so the page
 * keeps its height for its results.
 *
 * The page is `SidebarNotesController`, run by a `WebviewHost` in the view
 * VS Code resolves; this is the name the extension registers it by.
 */
export class SidebarNotesView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly controller: SidebarNotesController;
  private readonly host: WebviewHost<SidebarNotesPageState, SidebarNotesPageToHost>;

  /** Builds the sidebar; nothing is shown until VS Code resolves its view. */
  public constructor(options: SidebarNotesViewOptions) {
    this.controller = new SidebarNotesController({ ...options, navigation: new NavigationService() });
    this.host = new WebviewHost(this.controller, { indexer: options.indexer, themePreview: options.themePreview });
  }

  /**
   * Binds a VS Code webview view and draws it at once, and again once the
   * index has notes to show. The view is attached here rather than through
   * a `ViewAdapter`, since the sidebar sends its own state, at once and
   * once the first scan is published.
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    logRelatedNotes('Resolving Related Notes webview.');
    this.host.detach();
    webviewView.webview.options = { enableScripts: true };
    this.host.attach(new ViewSurface(webviewView));
  }

  /**
   * Releases view listeners and shared subscriptions.
   */
  public dispose(): void {
    this.host.dispose();
  }

  /**
   * Narrows the sidebar to one tagged entry selected from a Markdown hover.
   */
  public showRelatedNotesForEntry(documentUri: vscode.Uri, sourceLine: number): Promise<void> {
    return this.controller.showRelatedNotesForEntry(documentUri, sourceLine);
  }

  /**
   * Shows what a node chosen on the notes graph connects to, revealing the
   * sidebar first when asked.
   */
  public showGraphConnections(context: SidebarGraphContext, reveal = false): Promise<void> {
    return this.controller.showGraphConnections(context, reveal);
  }

  /** Goes back from a graph node's connections to the notes, if it shows them. */
  public clearGraphConnections(): void {
    this.controller.clearGraphConnections();
  }

  /**
   * How Related Notes ranks for one entry, for the debug page; undefined
   * when the saved note has no such tagged entry.
   */
  public getEntryDiagnostic(documentUri: vscode.Uri, sourceLine: number): Promise<EntryRelatedNotesDiagnostic | undefined> {
    return this.controller.getEntryDiagnostic(documentUri, sourceLine);
  }
}
