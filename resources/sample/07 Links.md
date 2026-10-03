# Links

A wiki link is a note's name in double brackets. It names the note by its
file name without `.md`, or by any name in the note's `aliases:` front
matter, so moving a note to another folder breaks nothing. After a `#`, a
link can name a heading, or one line that carries a `^marker` at its end.
The ways to write one:

```text
[[Note]]                  the note
[[Note|shown as]]         the note, shown as other words
[[Note#Heading]]          a heading in it
[[Note#^marker]]          the one line that ends in ^marker
[[#Heading]]              a heading in this note
![[Note#Heading]]         on a line of its own: draws that heading here in the preview
```

The section below holds a link of every kind. The Ghostline Relay note, in
the projects folder, is what most of them point at.

## Relay decision log #project/ghostline-relay

The pilot's scope is written in [[Ghostline Relay]], which also goes by
[[Relay]]. The ruling itself is under [[Ghostline Relay#Decision|the decision]],
and the line about quiet pings is [[Ghostline Relay#^threshold]]. What to do
with these links is under [[#Try it]], at the end of this note.

Ren will write the route, alerts, and log handling into [[Relay field test plan]]
before the next comparison. That note does not exist yet.

Mara's rule for the dawn team: nobody follows a target into a crowded stairwell. ^stairwell-rule

The line above carries its own marker, so any note can link to that one
line, as [[07 Links#^stairwell-rule]] does.

The threshold line, drawn from the relay note:

![[Ghostline Relay#^threshold]]

## Try it

1. Cmd/Ctrl-click any link above. The heading and marker links open the note
   at that heading or line, and the link to this note's own Try it heading
   jumps to this list. Hover a link to preview what it points at.
2. Open this note's preview (<kbd>Cmd</kbd>+<kbd>K</kbd> <kbd>V</kbd>). The
   embed is drawn as the line it names, with a link back to where it came
   from.
3. The link to the field test plan is marked as a problem, because no note
   has that name. Put the cursor on it and open the lightbulb
   (<kbd>Cmd</kbd>+<kbd>.</kbd>) for **Create note**. Stats also lists it
   under **Links that open no note**.
4. Open the Ghostline Relay note. Its first line says how many notes link to
   it, and the **Decision** heading says how many links name it. In the
   Related Notes sidebar, **Linked from** lists the notes that link here,
   each with its linking lines.
5. The Harbor hub note's first line says it is **mentioned** in notes without
   a link. Select **Link N mentions** to turn them into links, then
   **Deckard: Undo Last Change**.
6. Type two opening brackets on an empty line. Deckard offers your notes, and
   after a note's name and `#`, its headings. Type `[[tomorrow` and it offers
   the link to tomorrow's daily note. Delete the line afterward.
7. Rename the Ghostline Relay note in the Explorer. Every link to it here is
   rewritten, and one Undo takes back the rename and the links together.
8. Run **Deckard: Open Notes Graph Around This Note**. Solid lines are links
   you wrote, dashed lines a heading and the heading under it, and dotted
   lines a shared tag.
9. Run **Deckard: Copy as Plain Markdown** here, then paste into a new
   untitled file (<kbd>Cmd</kbd>+<kbd>N</kbd>). The embed is written out as
   the line it names, each link is its words, such as *Ghostline Relay ›
   Decision*, and the `^marker` is gone: ready for a chat, an email, or a
   pull request. Select a few lines first to copy only those.
10. In the Ghostline Relay note, put the cursor on the **Decision** heading
    and run **Deckard: Rename Heading**. Every `[[Ghostline Relay#Decision]]`
    link here is rewritten to the new name; **Undo** puts them back.

Search by link in [[04 Search]]; the queries are there.

Next: [[08 Daily notes and reviews]]
