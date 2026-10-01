import type * as vscode from 'vscode';

import { VIEW_PRIORITY } from '../core/workspace/publishing';
import type { PageWebview, WebviewSurface } from '../ui/webview/host/surface';

/**
 * A webview with only the two members a page's host talks through, for
 * host-controller tests: what the host posts is kept in `posted`, and
 * `send` delivers a message as the page would post it.
 *
 * Messages cross as JSON both ways, as they do between VS Code and a page,
 * so a test sees what the other side would.
 */
export class FakeWebview implements PageWebview {
  /** Everything the host has posted, oldest first. */
  public readonly posted: unknown[] = [];
  private readonly listeners: Array<(message: unknown) => unknown> = [];

  /** Keeps what the host posts. */
  public postMessage(message: unknown): Thenable<boolean> {
    this.posted.push(carry(message));
    return Promise.resolve(true);
  }

  /** Listens for what the page sends. */
  public readonly onDidReceiveMessage: vscode.Event<unknown> = (listener, thisArgs) => {
    const bound = (message: unknown): unknown => listener.call(thisArgs, message);
    this.listeners.push(bound);
    return {
      dispose: () => {
        const at = this.listeners.indexOf(bound);
        if (at >= 0) {
          this.listeners.splice(at, 1);
        }
      },
    };
  };

  /**
   * Delivers a message as the page posts it, and resolves when every
   * handler it reached has finished.
   */
  public async send(message: unknown): Promise<void> {
    await Promise.all([...this.listeners].map((listener) => listener(carry(message))));
  }

  /** The messages of one type the host has posted, oldest first. */
  public postedOf<T = { type: string }>(type: string): T[] {
    return this.posted.filter(
      (message): message is T => (message as { type?: unknown } | undefined)?.type === type,
    );
  }
}

/**
 * A panel around a fake webview, for a host to attach to: a test shows it,
 * hides it, brings it to the front, and closes it as the reader would. The
 * HTML a host sets is kept, built from the HTML function it is handed, but
 * only when a test supplies a webview able to build it.
 */
export class FakeSurface implements WebviewSurface {
  public visible = true;
  public active = true;
  /** How many times the host set the page's HTML. */
  public renders = 0;
  /** Whether the host closed the page. */
  public closed = false;
  /**
   * The webview the page's HTML is built for, such as the stand-in of
   * `pageWebview.ts`; without one, the HTML is only counted.
   */
  public htmlWebview: vscode.Webview | undefined;
  /** The HTML the host last set, when there is a webview to build it for. */
  public html: string | undefined;
  private readonly viewStateListeners: Array<() => void> = [];
  private readonly disposeListeners: Array<() => void> = [];

  /** Wraps a fake webview, or a new one. */
  public constructor(public readonly webview: FakeWebview = new FakeWebview()) {}

  /** Counts the render, and keeps the HTML when there is a webview to build it for. */
  public render(html: (webview: vscode.Webview) => string): void {
    this.renders += 1;
    if (this.htmlWebview) {
      this.html = html(this.htmlWebview);
    }
  }

  /** Listens for a show, hide, or focus change. */
  public onDidChangeViewState(listener: () => void): vscode.Disposable {
    return subscribe(this.viewStateListeners, listener);
  }

  /** Listens for the reader closing the page. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return subscribe(this.disposeListeners, listener);
  }

  /** In front, visible, or hidden, as a panel ranks. */
  public priority(): number {
    if (this.active) {
      return VIEW_PRIORITY.active;
    }
    return this.visible ? VIEW_PRIORITY.visible : VIEW_PRIORITY.hidden;
  }

  /** Records that the host closed the page. */
  public close(): void {
    this.closed = true;
  }

  /** Shows or hides the page, as switching tabs does. */
  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.active = visible;
    [...this.viewStateListeners].forEach((listener) => listener());
  }

  /** Closes the page, as the reader closing its tab does. */
  public dispose(): void {
    [...this.disposeListeners].forEach((listener) => listener());
  }
}

/** A message as the other side receives it: a copy, through JSON. */
function carry(message: unknown): unknown {
  return message === undefined ? message : JSON.parse(JSON.stringify(message));
}

/** Adds a listener to a list, and returns how to take it off again. */
function subscribe(listeners: Array<() => void>, listener: () => void): vscode.Disposable {
  listeners.push(listener);
  return {
    dispose: () => {
      const at = listeners.indexOf(listener);
      if (at >= 0) {
        listeners.splice(at, 1);
      }
    },
  };
}

/**
 * Records, in order, each time a host sets `surface`'s HTML and the type
 * of each message it posts there, from now on.
 */
export function recordSurface(surface: FakeSurface): string[] {
  const events: string[] = [];
  const render = surface.render.bind(surface);
  surface.render = (html) => {
    events.push('html');
    render(html);
  };
  const post = surface.webview.postMessage.bind(surface.webview);
  surface.webview.postMessage = (message: unknown) => {
    events.push(`post ${(message as { type?: unknown } | undefined)?.type}`);
    return post(message);
  };
  return events;
}
