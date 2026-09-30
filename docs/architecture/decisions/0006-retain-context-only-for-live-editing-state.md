# 0006. `retainContextWhenHidden` only where live editing state exists

**Status:** Accepted (2026-09-30)

## Context

All nine Deckard webviews set `retainContextWhenHidden: true`, including the two sidebar views. The official guide calls it the exception, for state that cannot be quickly saved and restored, and warns of its high memory overhead. The API documentation and the guide also disagree on whether a hidden retained webview receives messages. GitLens buffers and replays messages for that reason.

## Decision

`retainContextWhenHidden` stays only on the Dashboard's query editor and the Task Board's drag state. Every other page puts its UI state, such as scroll, selection, and open sections, into `setState`, so the serializers restore it. The stale refresh on `isStale` and `onDidChangeViewState` stays everywhere, including where the option is kept.

## Consequences

- Hidden pages stop holding their full script context in memory.
- Each page must save and restore its own UI state, and those `setState` shapes become persisted formats an upgrade must keep reading.
- The refresh is correct under either reading of the documentation.

## Alternatives considered

- **Keep it on every page.** Simpler, but it is the memory cost the guide warns against, for state that `setState` can hold.
- **Drop it everywhere.** A hidden query editor or a drag in progress holds live editing state that cannot be quickly saved.
