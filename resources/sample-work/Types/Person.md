---
deckard-type: person
rows: "@*"
notes: people/
---
# Person

| Field   | Kind   | Reverse | Also called   |
| ------- | ------ | ------- | ------------- |
| role    | Text   |         | title, job    |
| team    | Team   | members | squad         |
| manager | Person | reports | boss          |
| email   | Email  |         | mail, contact |

Everyone written as `@name`. A person's fields live in the front matter of
the note that describes them, such as [[Noor Haddad]].
