# 47 · Move a section

A day's note gathers what happened, and some of it turns out to belong
elsewhere: a meeting's notes that are really part of a project's plan. Move
to… moves lines and tasks but refuses a heading, and Extract Heading moves
a heading only into a new note. So a section that belongs under an existing
note's heading cannot get there without cutting and pasting, which loses
the trail back to the day. **Move to…** on a heading moves the heading and
everything under it, to any destination Move to… offers, and leaves a link
to it behind. Mockups: the "Lanes and Section Moves" artifact, section 3.

## What moves

The section is the heading at the cursor, or the heading of a selection
that starts on a heading line, and every line until the next heading at its
level or above, or the end of the note: its subheadings, lists, tasks, code
blocks, and text, as Extract Heading takes it. A selection that starts on a
heading moves that heading's section, whatever the selection's end.

## Where it can go

Move to…'s own picker, with one group added at the top (D1):

1. **Mentioned in this section**: the headings of the notes the section
   names, first the hub notes of its tags and people, then the notes its
   `[[links]]` name, each note's headings in order and the note itself
   ("at the end of the note"), at most ten entries.
2. The picker's groups as they are now: **New note…**, today's note, used
   last, and every heading.

The section's own note is left out of the headings offered beside the note
itself, so a section is never moved into itself.

## What is written

At the destination:

- **Under a heading**: at the end of that heading's section (before its
  next heading at its level or above), after a blank line, with its
  heading made one level deeper than the destination's and every
  subheading shifted alike, none deeper than `######` (D2).
- **At the end of a note, or today's note**: at the note's end after a
  blank line, its levels kept.
- **New note…**: named as Extract Heading names it, the section's heading
  as its title, which is Extract Heading's write.

Where it was, one line takes its place: a link to its new place, the
heading and its note, in `deckard.links.style`
(`[[Ledger migration#Ledger cutover plan]]`), so the day still says it
happened (D3). The move is one write across both notes that Undo takes
back, and it is refused, saying so, if either note changed between reading
the section and choosing the destination.

Links elsewhere to the section's old place (`[[2026-11-12#Ledger cutover
plan]]`) are left as they are; the line left behind leads on to the new
place (D4).

## Ways in

- **Deckard: Move to…** with the cursor on a heading line, or a selection
  that starts on one, in place of today's refusal.
- The lightbulb on a heading line: **Move section to…** (kind
  `refactor.move`), beside Extract Heading's.
- The outline's right-click menu, where Extract Heading already is, when
  the editor's context menu offers Move to…: the same command.

## Decisions

- **D1.** *Mentioned in this section* comes first because the place a
  section belongs is nearly always a note it already names; the rest of
  the picker is unchanged.
- **D2.** The moved heading nests under the destination heading, since a
  heading moved under `## Plan` at its own `##` would end the Plan section
  and start a new one.
- **D3.** One link line, not a summary or a copy: the day keeps a trail,
  and the text lives in one place.
- **D4.** Old links are not rewritten: the anchor named a day's heading,
  the line left behind still takes a reader on, and rewriting other notes
  would turn one move into many writes.

## Tests

- Unit: the section a heading line or a selection takes; the heading level
  shift under a heading and its cap; where under a heading it lands; the
  line left behind in both link styles; the mentioned group's entries and
  order; the section's own note left out.
- Host: Move to… on a heading moves the section under another note's
  heading and Undo restores both notes.
