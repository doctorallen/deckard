# 0014. Pages render synchronously from one store

**Status:** Accepted (2026-10-01)

## Context

About 300 page-driving tests, in `openWebviewPage` suites and the e2e suites, act on a page and read what it drew in the same tick: they send a `state` message or click a control, then query the DOM on the next line. The template pages could be tested that way because every redraw assigned `app.innerHTML` before the handler returned.

Preact's own way to change what a component draws is a hook: a `useState` update is queued and drawn in a microtask, and a `useEffect` runs after paint. A page built from component state would draw after the test had already read it. Every one of those tests would have to wait, and a page's first frame would depend on scheduling.

## Decision

Each page keeps one store, holding the snapshot its host sent and its own UI state, such as which lists are unfolded. A host message or a reader's action changes the store, which calls Preact's top-level `render(<Page …/>, app)`. That call diffs and patches synchronously, so the page is drawn before the handler returns.

Components take everything they draw as props. Hooks are limited to refs and `useLayoutEffect`, which runs synchronously at commit. Nothing a test or the first frame observes comes from `useState` or `useEffect`.

`src/webview/shared/page.ts` holds the store (`startPage`), the delegated `data-action` listener, and the place restore that runs after each draw.

## Consequences

- The page-driving tests keep their shape: send or click, then read.
- A page's whole state is in one value, which is also what it keeps with `setState` across a hide or a reload.
- Each draw renders the whole page from the root. Preact patches only what changed, but it walks the whole tree each time; a page large enough for that to cost a frame would need memoized subtrees, written against the same store.
- Focus follows the DOM Preact keeps: an element a draw keeps keeps its focus, and only focus the draw took away is put back.

## Alternatives considered

- **Component state with hooks, and asynchronous tests.** Idiomatic Preact, but every page test would await a render, and an assertion made too early would pass against the old page.
- **`@preact/signals`.** Signals update synchronously, but they are a second shipped package, and they make a later move to React harder; decision [0002](0002-preact-in-the-light-dom.md) leaves them out.
- **Flushing Preact's queue in the harness** (`options.debounceRendering`). It keeps tests synchronous, but the page would still draw differently in VS Code than in the tests.
