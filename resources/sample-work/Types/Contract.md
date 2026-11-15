---
deckard-type: contract
rows: "#contract/*"
notes: contracts/
---
# Contract

| Field      | Kind                                           | Reverse | Also called       | Words                           |
| ---------- | ---------------------------------------------- | ------- | ----------------- | ------------------------------- |
| client     | Text                                           |         | customer          |                                 |
| fee        | Number                                         |         | price, pay        |                                 |
| deliver-by | Date                                           |         | delivery          |                                 |
| lead       | Person                                         | lead on | point             | is on point for, takes point on |
| state      | Select: bidding, accepted, underway, delivered |         | stage, phase      |                                 |

Every `#contract/…` tag is a job the Corvid has bid on, taken, or flown,
such as [[Relay survey]]. Its state is called `state` rather than
`status`, which a search already reads as a task's status.
