# 0004. Hand-written message narrowing, one table, no validation library

**Status:** Accepted (2026-09-30)

## Context

A page's messages to its host are untrusted input. Today `messages.ts` validates them with hand-written check-then-cast parsers, eight of them, and twelve dashboard cases pass the whole record through with a double cast. `sidebarNotes.ts` parses three more types by hand outside the parser. Host-to-page messages are untyped literals, and the page side has no types at all. None of the five surveyed extensions validates page-to-host messages with a schema library at the host boundary.

## Decision

Each page's messages are declared once in `src/ui/protocol/<page>.ts`, imported by host and page. Validation stays hand-written, as one table of per-message narrowing functions shared across pages. No validation library is added.

## Consequences

- One table replaces the eight parsers and the three hand parses.
- A message type that one page shares with another is narrowed the same way on both.
- Nothing new ships in the host bundle; see [0011](0011-host-bundle-ships-no-third-party-code.md).
- Each narrowing function is code a person writes and a test must cover.

## Alternatives considered

- **`valibot`.** The earlier draft's choice. Dropped because no surveyed extension validates this boundary with a library, and it would add shipped code.
