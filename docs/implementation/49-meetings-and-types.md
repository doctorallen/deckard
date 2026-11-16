# 49 · Meetings where they belong, and a Types tab

Deckard is meant to do three things: manage tasks, keep the notes of many
meetings a day without losing their context, and hold a wiki that is easy
to add to. Tasks are close. Meetings are written, but their context is
fragile: a task carried to the next day loses the meeting it was said in,
and notes about a project sit in whichever daily note the meeting fell on,
related only by a tag. The wiki has no page that lists what it holds.

This plan makes six changes. Five let a meeting's notes live in the note of
the project or the person they are about, dated, linked from the day, and
followed by their tasks. The sixth gives the wiki a front page. Mockup of
the sixth: the "Deckard Types tab" artifact
(https://claude.ai/artifact/GPn7LrQuUr1WDbSS1azvZT).

## Principles

- **Notes live by location; tags cross-reference.** A meeting about
  Borealis is written in `Borealis.md`. A tag says what else it touches.
  Nothing here adds a tag feature.
- **A hub note describes; its meetings follow.** What is written above the
  first dated heading is the evergreen description of the project or
  person. Nothing marks where it stops but the first dated heading.
- **The day still lists what happened.** Today's note keeps a link to every
  meeting started from it, so reading a day back loses nothing.
- **Markdown says all of it.** A dated heading, a link line, and a
  sub-heading under Carried over are plain text Deckard reads back. No
  front matter, no ids, nothing stored outside the notes.

## 1. Dated headings

A heading that starts with a day, `## 2026-11-16 10:00 Vendor sync`, begins
a dated entry in any note that is not a daily note. The day is
`YYYY-MM-DD`, with an optional `HH:MM` after it, then the end of the
heading or anything that is not part of a longer number or word.

- The heading, every heading under it, and their tasks and questions take
  the day as both created and updated time. A search by date finds the
  meeting, lists sort it by the day it happened, and "next Friday" written
  in it counts from the meeting.
- A dated heading is one entry with every heading under it, tagged or not,
  and carries its note's tags.
- A dated heading is `##` or deeper. A level-1 heading with a date is a
  daily note's title, as before.
- A daily note has no dated entries: the whole note is about one day.
- A hub note is drawn on its tag's page down to its first dated heading.
  Each dated heading is listed below it as a note of its own.

`domain/markdown/datedHeadings.ts` holds the rule: `readHeadingDate`,
`dateSections`, `isDatedHeading`, `datedRanges`, `withoutDatedEntries`.

## 2. Start a Meeting

`Deckard: Start a Meeting` asks what the meeting is about and its name,
writes its heading where it belongs, and puts the cursor under it.

**What it is about.** One list, with checkboxes:

- **No one thing**, for today's note.
- **Written about lately**: tags that name a person, sit in a namespace, or
  have a hub note. A bare `#urgent` says how something is, not what a
  meeting is about. Each heading that carries the tag, and each dated
  heading of its hub note, counts `0.5 ^ (age in days / 14)`, and nothing
  after 60 days. The 12 with the highest total are listed.
- **Meeting notes**: notes that are no tag's hub and have a dated heading
  in the last 60 days, the latest held first, five at most.
- **A note of its own…**, for a meeting that recurs.

The first row checked is the meeting's home. Every subject checked after it
is a tag at the end of the heading; a note checked after it is left out,
since a meeting is written in one place. Enter with nothing checked takes
the row the cursor is on.

**Its name** is asked next and may be empty, except for a note of its own,
which is named for the meeting.

**What is written**, as one change `Deckard: Undo Last Change` takes back:

| Home | Heading, at the end of the note | Today's note |
| --- | --- | --- |
| A subject's hub note, made when it has none | `## 2026-11-16 10:00 Vendor sync @priya` | `- 10:00 [[Borealis#2026-11-16 10:00 Vendor sync]]` at its end |
| A meeting note | the same | the same |
| A note of its own, `Weekly staff.md`, made when no note has the name | `## 2026-11-16 10:00` | the same |
| Today's note | `## 10:00 Vendor sync #project/borealis` | no link |

The time is the clock's to the nearest five minutes. A tag the name already
writes is not written twice. Today's note is made when it is not there,
with the tasks a rollover carries in, so the day's first meeting does not
cost the day its rollover. The link is in the link style of today's note.

`domain/notes/meetings.ts` holds the rules; `ui/commands/startMeeting.ts`
asks, finds or makes the notes, and writes.

## 3. A section moved out of a daily note keeps its day

Move to… puts the daily note's day first in a section's heading when the
section leaves a daily note for a note that is not one:
`## Vendor sync #project/borealis` in `2026-11-16.md` becomes
`## 2026-11-16 Vendor sync #project/borealis` in `Borealis.md`, a dated
heading. A heading that already starts with a day keeps it. A section
moved to another daily note, or landing at level 1, is left as written.

This is how a meeting written under **No one thing** is filed later.

## 4. Carried tasks keep their meeting

The rollover writes a task that was under a heading under that heading
again, one level below **Carried over**, with a link to where it was first
written:

```markdown
## Carried over
- [ ] Renew the certificate

### Vendor sync #project/borealis @dana
([[2026-11-13#Vendor sync]])
- [ ] Ask about the spares
```

- The heading is the nearest above the task with tags of its own, else the
  outermost below the note's title. It gains the tags of the headings
  outside it that it lacks, so the task is still listed for the project
  and the person.
- A task carried again keeps the same heading and the same link, however
  many days it waits: the link leads to the meeting, not to yesterday.
- Two tasks from one meeting share one heading. Tasks under no heading go
  under Carried over itself, above any sub-heading.
- In move mode, a carried sub-heading left with only its link is removed
  from the note the tasks left.

`domain/notes/carriedHeadings.ts` finds the heading and merges the groups;
the Carried over section is rewritten in one edit.

## 5. Copy to…

`Deckard: Copy to…`, and **Copy instead of moving** in Move to…'s list,
write a line, a task, a selection, or a heading's section where Move to…
would put it and leave the original. The copy links to the heading it came
from: a line ends with `([[2026-11-16#Vendor sync]])`, and a section has
the link on a line of its own under its heading, with a blank line before
prose. A copied task is not ranked on a board.

Something said in a meeting can then go into the wiki note that keeps such
things without leaving the meeting.

## 6. A Types tab on Home, in place of the Hubs view

Home gains a third tab, **Types**, after Home and Tags.

- One row a type: what its rows are, how many it has and how many have a
  note, its open tasks and how many are overdue, and when it was last
  mentioned. The headings sort.
- Selecting a type opens its rows; the arrow before it lists its rows in
  place; **Add person…** starts a new row.
- **New type…** is above the table, with **Create type from tags…** beside
  it while there is no type.
- **Hub notes outside a type** are listed under the table: the hub notes no
  type's rows cover, a namespace of them as one line with **Create type
  from tags…**.
- `Deckard: Open Types` opens Home on the tab. The Left and Right Arrow
  keys go round the three tabs.

The **Hubs** sidebar view is removed, with **Sort Hubs By…** and its
per-hub "new" counts. `up:` front matter, the breadcrumb above a note, hub
notes, and **Create Hub Note for Tag** stay.

`ui/state/typesTab.ts` builds the tab's state and
`webview/dashboard/typesTab.tsx` draws it.

## Decisions

- **Dated entries are updated on their day**, not when the file was saved:
  correcting a typo in an old meeting does not bring it to the top.
- **Dated headings only outside daily notes, at level 2 or deeper**, so a
  daily note's title and the times written in it mean what they did.
- **Subjects offered** are people, namespaced tags, and tags with a hub
  note. Half-life 14 days, lookback 60 days, 12 subjects, 5 meeting notes.
- **Time to five minutes**, the nearest, since a meeting started at 9:58 is
  the 10:00.
- **The heading goes at the end of its note**, so meetings read oldest
  first under the description.
- **No message after the write.** The note opens on the heading; Undo Last
  Change takes it back.
- **Copy to… is a command and a row in Move to…'s list**, not an entry in
  the editor's right-click menu.
- **A section is dated only on leaving a daily note** for a note that is
  not one.
- **Types is a tab of Home**, not a page or a sidebar view, so the wiki's
  front page is one click from where the day starts.
- **`up:` and breadcrumbs stay** though the Hubs view goes: they cost
  nothing to keep and notes already use them.

## Tests

- `dated-headings.test.ts`: reading a day, dating sections and their tasks,
  entries, the hub drawn without them, since-last-looked.
- `meetings.test.ts`: subjects and their ranking, meeting notes, pick
  order, the plan, the heading and its time, placement, the link.
- `start-meeting.test.ts` (host): the list's rows, what Enter picks, the
  write to both notes and its Undo.
- `carried-headings.test.ts`, `rollover.test.ts`,
  `rollover-service.test.ts`: the heading a task is carried under, link
  reuse, merging, emptied headings.
- `move-section.test.ts`, `copy-lines.test.ts`: the day put first, the
  copy's link.
- `types-tab.test.ts`, `test/e2e/dashboardHome.e2e.js`, and the layout
  surfaces `dashboardTypes` and `dashboardTypesOpen`.

## As built

- A type's open-task total counts each task once, though it may belong to
  several rows.
- The types opened in place are not kept across a reload, and the sort is
  the page's own, by name first.
- A type's row opens on a click anywhere in it, and by keyboard through
  its name.
- A type whose rows are notes shows no **Last mentioned** when nothing
  links to them.
- A namespace line under **Hub notes outside a type** opens a search for
  `kind = <namespace>`.
- `deckard.hubs.sort` is left unread in workspace state; see
  `docs/architecture/inventories/persisted-formats.md`.
- The Tour keeps fifteen scenes; its Hubs scene is the Types tab.
- Start a Meeting about a tag with no hub note may ask the questions that
  tag's hub template asks, as Create Hub Note for Tag does.
- The visual baselines for Home and Tags change with the third tab, and
  the two new surfaces have none yet; the Nightly visual check makes the
  Linux PNGs.

**Known limit.** Since you last looked compares what a note held with what
it holds now. A meeting appended to a hub note can mark the entry before
it as changed when the lines between them move. Left as is until it is
seen to matter.
