---
deckard-type: person
rows: "@*"
notes: crew/
---
# Person

| Field      | Kind   | Reverse | Also called      | Words                      |
| ---------- | ------ | ------- | ---------------- | -------------------------- |
| role       | Text   |         | title, job, rank |                            |
| team       | Team   | members | section, watch   | moved to, joined, is on    |
| reports-to | Person | reports | boss, manager    | reports to, now reports to |
| email      | Email  |         | mail, contact    |                            |

Everyone written as `@name`, aboard or not. A person's fields live in the
front matter of the note that describes them, such as [[Juno Achterberg]].
