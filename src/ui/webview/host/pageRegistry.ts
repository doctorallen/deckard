/**
 * Deckard's open pages, as Help and the Tour reach them (plan 48, section 3).
 *
 * Every page's host joins while it has a panel or view and leaves when it
 * closes. Help and the Tour send `spotlight` and `explore` to every visible
 * page through `broadcast`, and only a page that has the target acts; a
 * page in explore mode tells its host what was picked, and the host hands
 * it here for whoever listens, Help's This page.
 */
import type { PageMessage } from '../../protocol/messaging';
import type { ExploreMessage, HelpPickedMessage, SpotlightMessage } from '../../protocol/shared';

/** An open page as the registry sees it: what it is, whether it shows, and its way in. */
export interface RegisteredPage {
  /** The page's controller name, such as `Task Board`. */
  readonly name: string;
  /** Whether the page is on screen now. */
  visible(): boolean;
  /** Sends the page one message. */
  post(message: PageMessage): void;
}

/** What a page picked in explore mode, and which page; no id when the reader left explore mode there. */
export interface PagePick {
  page: string;
  id?: string;
}

/** Something that can be stopped. */
export interface Stoppable {
  dispose(): void;
}

/** Deckard's open pages, one registry for the window. */
export class PageRegistry {
  private readonly pages = new Set<RegisteredPage>();
  private readonly listeners = new Set<(pick: PagePick) => void>();

  /** Adds a page while it is open; dispose to take it out. */
  public add(page: RegisteredPage): Stoppable {
    this.pages.add(page);
    return { dispose: () => this.pages.delete(page) };
  }

  /** The names of the pages open now, visible or not. */
  public openPages(): string[] {
    return [...this.pages].map((page) => page.name);
  }

  /**
   * Sends a spotlight or explore message to every visible page, or, with
   * `name`, to the visible pages of that name; says how many were sent it.
   */
  public broadcast(message: SpotlightMessage | ExploreMessage, name?: string): number {
    let sent = 0;
    this.pages.forEach((page) => {
      if (!page.visible() || (name !== undefined && page.name !== name)) {
        return;
      }
      page.post(message);
      sent += 1;
    });
    return sent;
  }

  /** Listens for picks; dispose to stop. */
  public onPicked(listener: (pick: PagePick) => void): Stoppable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** A page told its host what was picked. */
  public picked(pick: PagePick): void {
    this.listeners.forEach((listener) => listener(pick));
  }
}

/** The window's registry, which every host joins. */
export const pageRegistry = new PageRegistry();

/**
 * A `helpPicked` message as a page may send it, or undefined: an id of
 * word characters and hyphens, or none.
 */
export function narrowHelpPicked(value: unknown): HelpPickedMessage | undefined {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'helpPicked') {
    return undefined;
  }
  const id = (value as { id?: unknown }).id;
  if (id === undefined) {
    return { type: 'helpPicked' };
  }
  return typeof id === 'string' && /^[\w-]{1,80}$/.test(id) ? { type: 'helpPicked', id } : undefined;
}
