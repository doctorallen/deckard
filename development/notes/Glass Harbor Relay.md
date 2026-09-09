---
project: glass-harbor
organization: aurora-grid
people: [mara-vale, juno-rix]
topics: [signal-integrity, harbor-ops]
links:
  - [[Ghostline Cartography]]
  - [[Rainshadow Mesh]]
---

# Glass Harbor relay #project/glass-harbor #org/aurora-grid

The harbor's floodlights are supposed to guide cargo skiffs, but a salt fog has
been bending their timing into a second, invisible channel. The crew is
building a relay that can separate navigation truth from reflected noise.

## Tide-lock perimeter #district/glass-harbor #protocol/tide-lock

The perimeter will stay closed until the relay can identify a false beacon
without cutting service to the night ferries.

### Ghostwire uplink #network/ghostwire #topic/relay-coordination

Ghostwire gives the harbor relay a shared clock with the other districts. Its
packets are intentionally small so a damaged antenna can still pass an alert.

#### Saltglass telemetry #signal/harbor-chime #risk/fog-grid

The first trace shows a three-second echo below the southern gantry. The echo
looks harmless, but it moves whenever the foghorns change pitch.

- [ ] Compare the gantry echo with the midnight buoy trace.
- [ ] Ask @juno-rix to test the salt-resistant antenna sleeve.

#### Breakwater handoff #operator/juno-rix #artifact/tide-key

Juno found a maintenance key that can switch the relay between public and
contained modes without rebooting the navigation board.

- [x] Seal the maintenance key inside the harbor control case.
- [ ] Record the handoff in the Aurora Grid incident ledger.

## Night ferry decision #topic/harbor-ops

Mara wants one more contained run before the harbor lights are returned to
automatic mode. The decision will be reviewed after the next fog cycle.

