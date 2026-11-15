---
deckard-type: decision
rows: notes
notes: decisions/
---
# Decision

| Field      | Kind                                   | Reverse | Also called     |
| ---------- | -------------------------------------- | ------- | --------------- |
| date       | Date                                   |         |                 |
| state      | Select: proposed, accepted, superseded |         | status, outcome |
| decided-by | Person, many                           | decided | deciders        |
| contract   | Note                                   |         | job             |

A decision record is a note whose front matter says `type: decision`, such
as [[DEC-002 Burn profile]]. Its state is called `state` rather than
`status`, which a search already reads as a task's status.
