---
project: emberline-broadcast
organization: signal-foundry
people: [ivo-chen, sol-vance]
topics: [broadcast-ops, civic-alerts]
links:
  - [[Ash Meridian Watch]]
  - [[Mirror District Transit]]
---

# Emberline broadcast #project/emberline-broadcast #org/signal-foundry

Emberline is a low-band civic broadcast that can reach street radios when
every large network is unavailable. The crew is rebuilding the transmitter
chain from small rooftop units and hand-carried timing beacons.

## Redline district #district/emberline #protocol/redline

The broadcast must be clear enough for an emergency but quiet enough that it
cannot become a weapon for panic or false evacuation orders.

### Ghostwire uplink #network/ghostwire #topic/broadcast-coordination

Ghostwire gives the rooftops a common cadence and lets each unit reject a
message whose timing proof does not match the local beacon.

#### Ashen carrier #signal/ashen-carrier #risk/false-evacuation

An unauthorized carrier is repeating a familiar evacuation tone with one note
missing. The missing note may identify the transmitter.

- [ ] Capture the carrier from the river roof and the tram roof.
- [ ] Ask @sol-vance to compare it with archived civic alerts.

#### Red beacon runner #operator/ivo-chen #artifact/red-beacon

Ivo is moving a timing beacon between rooftops because the courier lane is
being watched. The beacon has enough charge for one broadcast window.

- [ ] Choose the safest roof before the weather front arrives.
- [x] Remove the runner route from the public maintenance map.

## Broadcast ethic #topic/civic-alerts

Every Emberline message names its source district, confidence level, and next
review time. A warning without those three details is not released.

