# Capture, move, and park

Notes do not stay where they were first written. This note is for getting
things in quickly, moving them where they belong, starting notes from a
template, and setting finished work aside.

## Capture

**Deckard: Capture** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>)
adds a task to today's note without leaving the editor you are in. The words
at the end are read as a quick add reads them: a day, a priority from `p1` to
`p4`, and a repeat rule. **Deckard: Capture Under a Heading** adds it under a
heading you pick instead, and Find offers to capture words that match nothing.

## Harbor inbox #team/harbor

Items land here first and are moved under the right heading later.

- [ ] Find a named relief for the east exits before the weekend
- Kenji's exit map needs a second pair of eyes before it goes to the clinic.

## Clinic handover checklist

This heading is ready to be its own note. Nothing links here yet.

- Consent forms stay in the clinic, never in the case ledger.
- Every handover names the person taking over and the time.
- A patient who declines a transfer is not asked twice in one shift.

## Templates

The templates folder holds two templates. Deckard does not index it, so the
placeholders in them are not read as notes, tags, or tasks.

- **Meeting** asks who ran the meeting and fills in the title, date, and time.
- **project** is named after the project namespace, so it starts every new
  hub note for a project tag.

## Parked notes

A **parked** note stays indexed and searchable, and is left out of the lists
of things to do: the Tasks view, the board, the status bar, rollover, the
calendar, Related Notes, and the Notes Graph. The Velvet Circuit note in the
archive folder is parked: its front matter carries the parked tag. Its open
task is on no list of things to do, and `is:parked` still finds it.

## Try it

1. Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> and type
   `Check the flood gauges tomorrow p1`. The line under the box shows the
   task it will write, due tomorrow at the highest priority. Press Enter; it
   is added to today's note, and you stay here.
2. Select the words *Kenji's exit map* above and run Capture. The words are
   already in the box, with a link back to the Harbor inbox heading.
3. Put the cursor on the relief task in the Harbor inbox and run **Deckard:
   Move to…** (it is on the lightbulb too). Choose **Today's note**. The task
   moves, and the line left here reads `- [>]` with a link to where it went.
   **Undo** in the message puts both notes back.
4. Put the cursor in the clinic handover checklist and run **Deckard:
   Extract Heading**. The section becomes a note of its own, and a link to it
   takes its place here.
5. Run **Deckard: New Note from Template**, choose **Meeting**, and give it a
   title. Deckard asks who ran it, then writes the note with today's date.
   Or, on an empty line in any note, type `/meet` and choose **Template:
   Meeting**: it is written right there, the date filled in and the cursor
   on *Who ran the meeting?*, to type over. Type `/` alone to see everything
   the menu offers, from a task or a heading to a query block.
6. Run **Deckard: Pin Note to Home** with the cursor in the Harbor inbox.
   Find, opened with nothing typed, now lists it first, and so does Home's
   **Pinned notes** widget once you add it (**Customize → Add widget**).
7. Select the Deckard button in this note's title bar (**Deckard: Note
   Actions…**). It lists what can be done where the cursor is, such as
   completing the task on its line or moving it. Press Escape.
8. In the Outline view, select the target button on a heading (**Focus
   Section**). The rest of the note folds away. **Unfold All Sections** in the
   view's title brings it back.
9. Search for `is:parked`. The Velvet Circuit note and its task are listed,
   marked **Parked**. Open the note and run **Deckard: Unpark Note**, and its
   task appears in the Tasks view. **Deckard: Park Note** parks it again.
10. Right-click the archive folder in the Explorer and choose **Deckard → Park
   Folder…** to park everything in it at once.

Next: [[10 Home, Stats, and the graph]]
