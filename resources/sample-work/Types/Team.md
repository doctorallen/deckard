---
deckard-type: team
rows: "#team/*"
notes: teams/
---
# Team

| Field   | Kind       | Reverse     | Also called     |
| ------- | ---------- | ----------- | --------------- |
| lead    | Person     | lead of     | head            |
| owns    | Area, many | owned by    | responsible for |
| on-call | Person     | on call for | oncall, pager   |
| channel | Text       |             | slack, support  |

Every `#team/…` tag is a team. Its fields live in its hub note, such as
[[Payments]].
