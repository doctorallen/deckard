# 2026-11-14

## #night-shift-checkins

### Mara

- #signal-integrity
  - A ghost packet is bouncing between the east junction and the old floodwall.
  - The relay telemetry stayed clean through the midnight interference surge.
  - The street kiosks are switching to amber mode during the blackout drills.
  - The waterfront corridor is almost ready for a controlled public run.
- #atmospheric-interference
  - The crew wants to push another firmware build after tuning the rooftop antenna.

### Ivo

#### Relay integrity #topic/signal-integrity

- A small CI experiment is connecting the district simulator to the neon relay.
- Met with @mara-vale about how the #nightgrid-cli handles unattended dispatches.
- Met with @ivo-chen about a live deployment in the submerged control room.
- #project/neon-relay
  - We need to meet with the signal runners to review the containment scenarios.

### Nyx

- #project/east-junction
  - Finishing a few pieces of feedback from the night-market operators.
  - Moving toward a rotating patrol schedule for the abandoned platform.

### Sol

- #project/sector-nine
  - Implementing sample fixes for access gates and encrypted message sharing.
  - Collecting a list of improvements for the sector map.
  - The next rehearsal should be ready for the shadow network this afternoon.

## Neon Relay onboarding #topic/launch-readiness

- Has a generator script for small signal relays and district-monitoring apps.
- Includes patterns for scaffolding a repository with a hardened layout.
- Builds a sample CI/CD pipeline from one encrypted configuration file.
- Avoids access requests by publishing the tools through the Lumen Transit package feed.
- "Patterns" provide reusable blueprints for a new street-level node.
- "Plugin" adds a spectral map overlay to the operator interface.
- Requires an application ID; a dispatch ticket alone is not enough.
- Suggests creating a monorepo application under a temporary relay ID.
- Create a repository from that template in the Lumen Transit network.
- Use trunk-based development for the night-shift crew.
- Create a relay workspace before scaffolding the control application.
- Move one of the district interfaces into the generated workspace.
- Tie service accounts and deployment settings to the relay application ID.
- Keep the process similar to the Sector Nine launch checklist.
