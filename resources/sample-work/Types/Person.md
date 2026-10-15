---
deckard-type: person
rows: "@*"
notes: people/
---
# Person

| Field   | Kind   | Reverse | Also called   | Words                        |
| ------- | ------ | ------- | ------------- | ---------------------------- |
| role    | Text   |         | title, job    |                              |
| team    | Team   | members | squad         | moved to, joined, is on      |
| manager | Person | reports | boss          | reports to, now reports to   |
| email   | Email  |         | mail, contact |                              |

Everyone written as `@name`. A person's fields live in the front matter of
the note that describes them, such as [[Noor Haddad]].
