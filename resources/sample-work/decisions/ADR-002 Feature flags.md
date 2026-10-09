---
type: decision
date: {{date-2}}
state: accepted
decided-by: ["@alex-rivera", "@theo-park"]
project: "[[Checkout v2]]"
---
# ADR-002 Feature flags #decision #project/checkout-v2

## Context
[[Checkout v2]] has to ship to a slice of customers first, and come back
off without a deploy.

## Decision
One flag, `checkout-v2`, read by every service, at 5%, then 25%, then
everyone. Each old flag is removed once the new one is at 100% for a week.

## Consequences
- Two services still read the old flag; see the standup on [[{{date}}]].
