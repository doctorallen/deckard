---
describes: project/ghostline-relay
aliases: [Relay]
status: pilot
owner: "#person/ren-kade"
counsel: "#person/pritchard-vale"
---
# Ghostline Relay

A passive receiver network that tells a licensed service android from a
fleeing military-grade model without turning every streetlight into a
checkpoint. Ren Kade runs the pilot on one route beneath the monorail.

## Requirements

- Classify only authorized capability classes, never civilian identity.
- Store no raw commuter identifiers, faces, audio, or device serials.
- Publish a civilian opt-out corridor before each field comparison.
- Manual observation, not the receiver, is the sole basis for any field decision.

## Decision

The pilot stays on one route until the privacy review is done, and a range
ping raises an alert only above a documented confidence threshold.

A ping below the threshold is logged in aggregate and never shown to a field team. ^threshold

## Open questions

- Whether the receivers can be audited by someone outside the vendor.
- How long aggregate error metrics are kept.
