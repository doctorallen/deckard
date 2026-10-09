---
describes: project/checkout-v2
owner: "@alex-rivera"
launch: "{{date+10}}"
---
# Checkout v2

A new checkout for the web store: one page instead of three, the card
form from [[ADR-001 Card form]], and a rollout behind flags as
[[ADR-002 Feature flags]] says.

## Who is involved
- @noor-haddad builds the payment form.
- @theo-park owns the flags and the old checkout's removal.
- @ines-duarte is the product manager and sets the launch date.
- @sam-okafor watches the 3DS alerts on call.

## Still open

```deckard
#project/checkout-v2 is:open
```

## Decisions

```deckard view=table noteColumns=date,state,decided-by
type = decision AND project = this
```

## Launch checklist
- [ ] Load test the new checkout #project/checkout-v2 📅 {{date+5}} 👤 @sam-okafor
- [ ] Write the support macro for card errors #project/checkout-v2 📅 {{date+6}}
- [x] Staging sign-off from design #project/checkout-v2 ✅ {{date-3}}
