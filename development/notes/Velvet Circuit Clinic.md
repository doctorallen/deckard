---
project: velvet-circuit
organization: softline-clinics
people: [mara-vale, orrin-kyte]
topics: [medical-ops, synthetic-memory]
links:
  - [[Copper Rain Market]]
  - [[Null Garden Memory]]
---

# Velvet Circuit clinic #project/velvet-circuit #org/softline-clinics

Velvet Circuit is a night clinic protocol for keeping patient records available
when the city network is unreliable. It stores only the minimum needed at each
clinic and lets the rest remain encrypted in the care archive.

## Quiet ward district #district/velvet-circuit #protocol/quiet-ward

The ward network must protect both the patient's identity and the timing of a
critical treatment. The system is designed for silence before convenience.

### Ghostwire uplink #network/ghostwire #topic/clinic-sync

The uplink moves signed treatment summaries between clinics without copying
raw memory captures into the public transit mesh.

#### Pulseglass consent #signal/pulseglass #risk/record-drift

A consent record arrived with a correct signature but an impossible sequence
number. The clinic will not accept it until the source terminal is inspected.

- [ ] Compare the sequence with the patient's local paper card.
- [ ] Ask @orrin-kyte to isolate the source terminal.

#### Red room courier #operator/mara-vale #artifact/red-room-token

Mara is carrying a token that can open the clinic's offline archive for one
review window and then destroys its own access trail.

- [ ] Schedule the review after the ward quiet period.
- [ ] Store the destroyed-token report in the care archive.

## Care threshold #topic/medical-ops

The clinic's rule is simple: an uncertain record may delay a noncritical
procedure, but it may never delay emergency stabilization.

