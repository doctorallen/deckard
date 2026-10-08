---
describes: project/receiver-firmware
up: "[[Ghostline Relay]]"
status: bench testing
---
# Receiver firmware

The firmware the relay's passive receivers run: what they listen for, how
long they keep a reading, and the confidence a range ping needs before it
raises anything. It is a project of its own, but it exists only for the
relay, so its `up:` front matter files it under Ghostline Relay. In the
**Hubs** view it sits one level down: Projects › Ghostline Relay › Receiver
firmware.

## Constraints

- Readings below the alert threshold are kept in aggregate only, as the
  relay's decision requires.
- No update ships without the bench log showing a full night's run.
