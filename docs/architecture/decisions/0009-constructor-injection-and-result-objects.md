# 0009. Constructor injection into a plain `Services` object, and result objects

**Status:** Accepted (2026-09-30)

## Context

Module-level `let`s and singletons stand in for injection today, and pure functions read them. Four test suites reset them in teardown. The surveyed extensions show the cost of the alternatives. GitLens's `Container.instance` proxy and Dendron's `ExtensionProvider` both carry comments working around a static locator, and vscode-python labels its Inversify fields legacy. For outcomes, Foam returns or throws, Dendron returns `undefined` for cancellation, and GitLens and git throw typed errors mapped to messages in one wrapper.

## Decision

Each service takes its collaborators in its constructor. `createServices(context)` builds them once into a plain `Services` object. There is no container and no static locator.

A refusal is a result object, such as `{ kind: 'refused', reason: 'already-parked', paths }`. One `runCommand(id, handler)` wrapper swallows `vscode.CancellationError` silently, logs unexpected exceptions, and shows one generic message.

## Consequences

- A service can be built in a test with fake ports, which makes the fast test tier possible.
- Every outcome is a value a unit test can assert.
- No handler needs its own `try`.
- Result objects are Deckard's own convention; none of the surveyed extensions uses them.

## Alternatives considered

- **`tsyringe` or `inversify`.** Decorator containers need `reflect-metadata` and `emitDecoratorMetadata`, which esbuild does not support without a Babel shim.
- **A static locator.** The extensions that use one work around it in comments.
- **Throw typed errors for refusals.** A refusal is an expected outcome, and a value is easier to test than a throw.
