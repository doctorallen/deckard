---
deckard-type: team
rows: "#team/*"
notes: teams/
---
# Team

| Field   | Kind       | Reverse     | Also called     | Words                           |
| ------- | ---------- | ----------- | --------------- | ------------------------------- |
| lead    | Person     | lead of     | head            | leads, led by, now leads, heads |
| owns    | Area, many | owned by    | responsible for | owns, took over                 |
| on-call | Person     | on call for | oncall, pager   | is on call for, covers          |
| channel | Text       |             | slack, support  |                                 |

Every `#team/…` tag is a team. Its fields live in its hub note, such as
[[Payments]]. A line such as "@sam-okafor now leads #team/payments" offers,
on its lightbulb, to set Payments' lead: the Words column says which
phrases mean which field.
