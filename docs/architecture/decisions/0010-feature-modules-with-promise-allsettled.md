# 0010. Feature modules run with `Promise.allSettled`

**Status:** Accepted (2026-09-30)

## Context

`activate()` in `src/extension.ts` does everything today, and the service list is written four times: `activeServices`, the subscriptions push, `deactivate()`, and the `ExtensionServices` interface. The copies already disagree: `deactivate()` omits `notesGraph`. Foam registers features as modules. Markdown All in One's per-module `activate(context)` and the git extension's single `Disposable.from(...)` push are the same pattern.

## Decision

`features` is one ordered array of `(context, services) => void | Promise<void>`. `activate()` builds the services and pushes them into `context.subscriptions` at once. It then runs `Promise.allSettled(features.map(...))` and logs any feature that failed, rather than failing activation. Everything registers in `activate()`, with no lazy activation.

## Consequences

- A feature that throws cannot leave watchers alive, because the services are already owned by `context.subscriptions`.
- One broken feature is logged, and the rest activate.
- `activeServices`, `ExtensionServices`, and the hand-written `deactivate()` list go away.

## Alternatives considered

- **Fail activation on any error.** One bug would take every feature down.
- **Lazy activation**, as ESLint's placeholder and GitLens's `once(container.onReady)` do. Those exist for expensive startups. Since VS Code 1.74, contributed commands need no `onCommand` events, and Deckard's index already builds in the background.
