---
project: mirror-district
organization: lumen-transit
people: [mara-vale, tal-oss]
topics: [transit-ops, public-safety]
links:
  - [[Project Neon Relay]]
  - [[Glass Harbor Relay]]
---

# Mirror District transit #project/mirror-district #org/lumen-transit

Mirror District's elevated loop reflects advertisements so brightly that
drivers cannot see the maintenance signals beneath them. The transit crew is
turning the reflections into a secondary safety channel.

## Prismline district #district/mirror-district #protocol/prismline

The loop will not reopen until every platform can display the same emergency
pattern without relying on the ad network.

### Ghostwire uplink #network/ghostwire #topic/transit-coordination

Ghostwire gives the platforms a shared sequence number while keeping local
brake controls independent.

#### Chrome hush signal #signal/chrome-hush #risk/platform-glare

The west platform is receiving a silent emergency pattern during normal
service. It may be a reflection from the Neon Relay test corridor.

- [ ] Record the pattern from three platform angles.
- [ ] Ask @tal-oss to compare it with the harbor light protocol.

#### Turnstile witness #operator/mara-vale #artifact/witness-token

Mara found a maintenance token whose access history stops at the exact minute
the west platform began reflecting the false emergency pattern.

- [ ] Preserve the token's local audit trail.
- [ ] Interview the platform crew before changing the signal schedule.

## Safe reopening #topic/public-safety

The loop will reopen in sections, with a human operator at every platform
until the reflected patterns remain stable for one full service cycle.

