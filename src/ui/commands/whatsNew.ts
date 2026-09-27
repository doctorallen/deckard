import * as vscode from 'vscode';

import {
  compareVersions,
  isFeatureUpdate,
  parseChangelog,
  Release,
  releasesWithHighlights,
  shortVersion,
} from '../../core/changelog';
import { reportError } from '../../core/timing';

/**
 * What is new since the reader last ran Deckard.
 *
 * After an update that adds features (a major or minor step), Home says so
 * in one line until the reader opens What's new or dismisses it; Help lists
 * the Highlights of recent releases either way. A patch, a downgrade, and a
 * new install say nothing: a new install gets the walkthrough instead. There
 * is never a toast.
 */

export const LAST_SEEN_VERSION = 'deckard.lastSeenVersion';
export const WHATS_NEW_PENDING = 'deckard.whatsNewPending';
/** The last version before Deckard tracked the version seen. */
export const FIRST_TRACKED_FROM = '1.22.0';

interface PendingUpdate {
  from: string;
  to: string;
}

export interface WhatsNewOptions {
  globalState: vscode.Memento;
  /** The running version, from the manifest. */
  version: string;
  /** Whether this machine ran Deckard before, read before anything was stored. */
  existingUser: boolean;
  /** Reads CHANGELOG.md; unreadable reads as no releases. */
  readChangelog: () => Promise<string>;
  /** Whether `deckard.showWhatsNew` is on. */
  isShown?: () => boolean;
}

export class WhatsNew implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when the line Home shows appears or goes. */
  public readonly onDidChange = this.changeEmitter.event;
  private cached: Promise<Release[]> | undefined;

  public constructor(private readonly options: WhatsNewOptions) {}

  /** Every release in the shipped changelog, read once. */
  public releases(): Promise<Release[]> {
    this.cached ??= this.options.readChangelog().then(parseChangelog, (error: unknown) => {
      reportError("Deckard could not read its changelog, so What's new lists nothing.", error);
      return [];
    });
    return this.cached;
  }

  /** Records the version run, and notes a feature update that has Highlights. */
  public async onActivate(): Promise<void> {
    const { globalState, version } = this.options;
    let seen = globalState.get<string>(LAST_SEEN_VERSION);
    if (seen === undefined) {
      if (!this.options.existingUser) {
        await globalState.update(LAST_SEEN_VERSION, version);
        return;
      }
      seen = FIRST_TRACKED_FROM;
    }
    if (compareVersions(version, seen) > 0 && isFeatureUpdate(seen, version)) {
      const fresh = releasesWithHighlights(await this.releases(), seen, version);
      if (fresh.length > 0) {
        const pending = globalState.get<PendingUpdate>(WHATS_NEW_PENDING);
        await globalState.update(WHATS_NEW_PENDING, { from: pending?.from ?? seen, to: version });
        this.changeEmitter.fire();
      }
    }
    await globalState.update(LAST_SEEN_VERSION, version);
  }

  /** The line Home shows, while there is one and the setting allows it. */
  public pending(): { version: string } | undefined {
    const pending = this.options.globalState.get<PendingUpdate>(WHATS_NEW_PENDING);
    if (!pending || !(this.options.isShown?.() ?? true)) {
      return undefined;
    }
    return { version: shortVersion(pending.to) };
  }

  /** The version the reader updated from, so Help can mark what is new since. */
  public newSince(): string | undefined {
    return this.options.globalState.get<PendingUpdate>(WHATS_NEW_PENDING)?.from;
  }

  /** The reader has seen it, or does not want to. */
  public async clear(): Promise<void> {
    if (this.options.globalState.get(WHATS_NEW_PENDING) === undefined) {
      return;
    }
    await this.options.globalState.update(WHATS_NEW_PENDING, undefined);
    this.changeEmitter.fire();
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** Reads `deckard.showWhatsNew`. */
export function isWhatsNewShown(): boolean {
  return vscode.workspace.getConfiguration('deckard').get<boolean>('showWhatsNew', true);
}
