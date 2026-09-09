---
project: rainshadow-mesh
organization: aurora-grid
people: [sera-nox, juno-rix]
topics: [storm-response, infrastructure]
links:
  - [[Glass Harbor Relay]]
  - [[Emberline Broadcast]]
---

# Rainshadow mesh #project/rainshadow-mesh #org/aurora-grid

Rainshadow is a storm-response mesh for the towers beyond the seawall. It
routes weather warnings, elevator status, and rescue requests through battery
nodes that can survive a night of acid rain.

## Seawall district #district/rainshadow #protocol/seawall

The mesh chooses the shortest safe route rather than the fastest route. A
packet that crosses an unstable tower is treated as delayed, not delivered.

### Ghostwire uplink #network/ghostwire #topic/storm-coordination

Ghostwire shares tower confidence scores with the harbor and blackout
projects, but it never assumes that a powered tower is a safe tower.

#### Rainknife trace #signal/rainknife #risk/tower-collapse

The southern tower is reporting a clean battery state while its elevator
telemetry is dropping every ninth packet. The mismatch could hide trapped
maintenance crews.

- [ ] Send a passive diagnostic before the next rain band.
- [ ] Ask @juno-rix to compare the battery state with the harbor relay.

#### Bluewall responder #operator/sera-nox #artifact/bluewall-tag

Sera found a responder tag under the seawall stairs. It still contains a
single-use route token for the old rescue elevators.

- [ ] Test the token against an isolated elevator controller.
- [ ] Add the route to the Ghostline confidence map if it remains stable.

## Storm threshold #topic/storm-response

The mesh enters rescue mode when two towers report the same pressure change.
Until then, it keeps warnings local and preserves battery for people already
inside the storm corridor.

