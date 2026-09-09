---
project: blackout-veil
organization: volt-commons
people: [ivo-chen, sera-nox]
topics: [power-routing, emergency-ops]
links:
  - [[Glass Harbor Relay]]
  - [[Emberline Broadcast]]
---

# Blackout Veil protocol #project/blackout-veil #org/volt-commons

The Veil is a neighborhood-scale power protocol for the minutes after a
gridwide brownout. It keeps clinic doors, tram brakes, and rooftop farms alive
while the central grid decides which districts can wake first.

## Low-sun perimeter #district/blackout-veil #protocol/low-sun

The first rule is restraint: no tower may pull more current than its local
capacitor can safely return.

### Ghostwire uplink #network/ghostwire #topic/grid-handshake

The uplink shares capacitor forecasts with neighboring projects and refuses
requests that would create a second blackout behind the first.

#### Veil pulse #signal/veil-pulse #risk/blackout-drift

An old switching cabinet is sending a pulse before every scheduled load drop.
The pulse could be a warning or a hostile attempt to claim the reserve.

- [ ] Capture six pulse cycles without waking the cabinet.
- [ ] Compare the pulse cadence with the Glass Harbor fog trace.

#### Quiet courier #operator/sera-nox #artifact/black-box

Sera is carrying a sealed diagnostic box through the maintenance tunnels. The
box has no wireless interface and will only open beside the reserve console.

- [ ] Meet @sera-nox at the west capacitor stair.
- [x] Remove the courier route from the public dispatch board.

## Reserve release #topic/emergency-ops

Ivo will authorize the first release when two independent meters agree. The
Veil must fail closed if either meter begins reporting impossible voltage.

