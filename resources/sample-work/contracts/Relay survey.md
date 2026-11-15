---
describes: contract/relay-survey
client: Belt Relay Co-op
fee: 48,000
deliver-by: {{date+10}}
lead: "@tomas-vey"
state: underway
---
# Relay survey

Twelve relay buoys for the Belt Relay Co-op, set along three legs out of
Pallas Yard, with the survey array mapping the sky around each one. The
route is [[DEC-001 Survey route]]; the way we fly it is
[[DEC-002 Burn profile]]. The legs are in the [[Survey flight plan]], and
what happens to each buoy is in the [[Buoy checklist]].

## Who is involved
- @tomas-vey leads it, plots the burns, and flies them.
- @dev-laurent sets the buoys by EVA, with @lio-marsh learning alongside.
- @ottilie-brandt talks to the co-op and files with Pallas Yard.
- @amara-kibet at Pallas Yard brokered it.

## Survey work #contract/relay-survey #team/flight
- [ ] Recalibrate the survey array 📅 {{date+6}} 👤 @tomas-vey
- [/] Plot the leg three burns ⏫ 📅 {{date+2}} 👤 @tomas-vey
- [w] Belt Relay Co-op confirms where buoy 11 goes 📅 {{date+4}} 👤 @ottilie-brandt
- [ ] Set buoys 9 to 12 📅 {{date+8}} 👤 @dev-laurent
- [ ] Write the survey report for the co-op 📅 {{date+9}} 👤 @tomas-vey
- [ ] Send the co-op the final survey data 🔼 📅 {{date+10}}
- [x] Calibrate the survey array at Pallas Yard ✅ {{date-25}}
- [x] Set buoys 1 to 4 ✅ {{date-13}}
- [x] Set buoys 5 to 8 ✅ {{date-8}}
- [x] Send Belt Relay Co-op the leg two data ✅ {{date-2}}

## Still open

```deckard
#contract/relay-survey is:open
```

## Decisions

```deckard view=table noteColumns=date,state,decided-by
type = decision AND contract = this
```
