# 0005. Inert JSON for initial state

**Status:** Accepted (2026-09-30)

## Context

A page needs its first snapshot before it can draw. Across the surveyed extensions, initial state reaches the page one of two ways: embedded as inert data, or by a ready handshake followed by a push. GitLens uses a base64 attribute on the app element. `@microsoft/vscode-ext-webview` uses an `application/json` block with `<` escaped. Neither interpolates JSON into an executable script.

## Decision

The first snapshot is embedded as `<script type="application/json" id="state">`, with `<` escaped. JSON is never interpolated into executable script. Updates keep arriving through `postMessage({ type: 'state' })`.

## Consequences

- The page draws on its first frame, with no "Loading…" flash.
- Note content inside the snapshot cannot break out into script, because the block is data the browser never runs.
- `{ type: 'state', data }` stays the entry point the tests already drive.

## Alternatives considered

- **A ready handshake and a push.** Correct, but the page shows nothing until the round trip completes.
- **A base64 attribute, as GitLens does.** It comes to the same thing; the JSON block is chosen as `vscode-ext-webview`'s mechanism.
