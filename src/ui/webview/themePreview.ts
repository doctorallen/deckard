import { Emitter } from '../../core/emitter';
import type { Event } from '../../ports/events';
import type { DeckardTheme } from './themeNames';

/**
 * A theme shown on the open pages while Choose Theme… is moved through, and
 * before anything is written: settings.json is not touched until one is
 * kept, so arrowing through eight themes makes no file writes.
 *
 * One is made where the extension starts and handed to Choose Theme… and to
 * every page, which draws with it and redraws when it changes, so a preview
 * reaches every open page and a test previews on a preview of its own.
 */
export class ThemePreview {
  private previewed: DeckardTheme | undefined;
  private readonly changeEmitter = new Emitter<void>();
  /** Fires when the previewed theme changes, so the pages redraw. */
  public readonly onDidChange: Event<void> = this.changeEmitter.event;

  /** The theme being previewed, or undefined while none is. */
  public get current(): DeckardTheme | undefined {
    return this.previewed;
  }

  /**
   * Shows a theme on the open pages without writing it, or stops
   * (undefined). A silent change redraws nothing, for when the setting's own
   * change is about to.
   */
  public show(theme: DeckardTheme | undefined, options: { silent?: boolean } = {}): void {
    if (this.previewed === theme) {
      return;
    }
    this.previewed = theme;
    if (!options.silent) {
      this.changeEmitter.fire();
    }
  }
}
