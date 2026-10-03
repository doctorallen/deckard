/**
 * The one handle VS Code gives a page's script: its way to its host, and
 * what it keeps for the page across a reload. VS Code hands it out once per
 * page, so every module asks here rather than calling `acquireVsCodeApi`.
 */
export interface VsCodeApi {
  /** Sends the host one message, which VS Code carries as JSON. */
  postMessage(message: unknown): void;
  /** What the page last kept with `setState`, or what VS Code restored. */
  getState(): unknown;
  /** Keeps a value for the page across a hide, a reload, and a restart. */
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

/** The page's handle, acquired the first time anything asks for it. */
export function vscodeApi(): VsCodeApi {
  api ??= acquireVsCodeApi();
  return api;
}

/** Sends the host one message. */
export function post<M extends { readonly type: string }>(message: M): void {
  vscodeApi().postMessage(message);
}

/**
 * What the page kept with `keepState`, as a record, or an empty one when it
 * kept nothing or something that is not a record. What comes back may have
 * been written by an older release, so each field is checked where it is
 * read.
 */
export function keptState(): Readonly<Record<string, unknown>> {
  const kept = vscodeApi().getState();
  return kept && typeof kept === 'object' && !Array.isArray(kept) ? (kept as Record<string, unknown>) : {};
}

/** Keeps `change` over what the page kept before, field by field. */
export function keepState(change: Readonly<Record<string, unknown>>): void {
  vscodeApi().setState({ ...keptState(), ...change });
}
