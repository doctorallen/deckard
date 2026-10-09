---
type: decision
date: {{date-9}}
state: accepted
decided-by: ["@alex-rivera", "@noor-haddad"]
project: "[[Checkout v2]]"
---
# ADR-001 Card form #decision #project/checkout-v2

## Context
The old checkout built its own card fields, which put card numbers in our
pages and our audit scope.

## Decision
Use the payment provider's hosted card fields. Card data never reaches our
servers.

## Consequences
- Styling is limited to what the hosted fields allow.
- Error messages come from the provider; we map them in the support macro.
