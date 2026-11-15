---
describes: contract/ice-haul
client: Pallas Yard
fee: 31,500
deliver-by: {{date+24}}
lead: "@ottilie-brandt"
state: accepted
---
# Ice haul

Forty tonnes of water ice from Thule Station to Pallas Yard, once the relay
survey is delivered. @amara-kibet brokered it. Which way we fly it is still
open: [[DEC-003 Ice haul route]].

## Before we load #contract/ice-haul #team/command #port/thule-station
- [ ] Renew the cargo insurance for the ice haul 🆔 insurance 📅 {{date+8}} 👤 @ottilie-brandt
- [ ] Book a loading berth at Thule Station ⛔ insurance 📅 {{date+12}}
- [x] Ask Amara for the ice haul terms ✅ {{date-9}} 👤 @ottilie-brandt

## Decisions

```deckard view=table noteColumns=date,state,decided-by
type = decision AND contract = this
```
