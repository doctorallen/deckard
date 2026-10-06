# Tasks

Any Markdown checkbox is a task. Deckard reads the dates, priority, and repeat
rule written on the line, and lists the task in the **Tasks** view in the
Deckard sidebar, on the Task board, on Home, and in searches. Nothing is kept
anywhere but this file: complete a task in any of those places and the
checkbox here is ticked.

This note holds one task for each state a task can be in. The dates were set
on the day the sample was made, so they read as overdue, due today, and due
later whatever day that was.

## How a task is written

A task is `- [ ]`, or `- [x]` once done, then its words, then its metadata
anywhere on the line. The markers are the ones the Obsidian Tasks plugin
writes, so a note written for Obsidian works here unchanged:

```text
📅 due        ⏳ scheduled (the day you plan to work on it)   🛫 start (not before this day)
✅ done       🔺 ⏫ 🔼 🔽 ⏬ priority, highest to lowest        🔁 repeat rule
🆔 an id      ⛔ the ids it waits for                          👤 who it is for
```

Deckard draws the metadata fainter than the words, and adds a hint at the end
of the line: **overdue 2 days**, **due today**, or **needs a new date**.

## Ghostline field trial #project/ghostline-relay

- [ ] Set a minimum confidence threshold for range-ping alerts ⏫ 📅 {{date-2}}
- [ ] Return the calibrated lens to the evidence custodian 📅 {{date-6}}
- [ ] Renew the Praxis Loom receiver lease 📅 {{date-40}}
- [ ] Publish the civilian opt-out corridor 🔺 📅 {{date}}
- [ ] Draft the passive-ping test route ⏳ {{date}}
- [ ] Book the monorail maintenance window 📅 {{date+1}}
- [ ] Get Pritchard Vale's privacy review of the pilot route 🛫 {{date-4}} 📅 {{date+3}}
- [ ] Brief counsel on the receiver logs ⏳ {{date+2}} 📅 {{date+6}}
- [ ] Rerun the falloff test at the east exits 🛫 {{date+5}} 📅 {{date+12}}
- [ ] Write the pilot's close-out report 🔽 📅 {{month+1}}
- [ ] Measure false positives at clinic entrances
- [ ] Encrypt the approved test logs [due:: {{date+9}}] [priority:: medium]
- [x] Record the privacy boundary in the procurement request ✅ {{date}}
- [x] Prohibit storing raw commuter identifiers ✅ {{date-3}}

## What each task shows

Every task under the field trial heading carries the project tag, because a
task inherits the tags of the heading it is written under. Reading down the
list:

- The first two are **overdue**. The third was due 40 days ago: past 30 days
  a task **needs a new date** instead, and leaves the Overdue count, the
  badge, and the status bar until you give it one.
- *Publish the civilian opt-out corridor* is **due today**, at the highest
  priority. *Draft the passive-ping test route* has no due date, but it is
  scheduled for today, so it is on today's list as well.
- *Book the monorail maintenance window* is due tomorrow. *Get Pritchard
  Vale's privacy review* has started and is due in three days. *Brief
  counsel* is scheduled in two days and due in six.
- *Rerun the falloff test* **starts** in five days: until then it is not
  something you can start now.
- *Write the pilot's close-out report* is due in the middle of next month, at
  low priority. *Measure false positives* has no date at all.
- *Encrypt the approved test logs* is written in the **Dataview format**,
  which spells the same fields out in brackets. Deckard reads both, and
  writes whichever one a line already uses.
- The last two are done. One was done today, so it is under **Done today**.

## Steps

A checkbox indented under a task is one of its **steps**. The task says how
far along it is, and its steps do not become tasks of their own on the board
or in the Tasks view. In the editor, a lens above the task draws a bar of
how many are done and names the next one.

## Dawn watch #team/wardens

- [ ] Pack the field kit for the dawn watch 📅 {{date+1}}
  - [x] Charge the lens battery
  - [ ] Pack the rain shells
  - [ ] Sign out the radio

## Try it

1. Open the **Tasks** view (the checklist icon in the Deckard sidebar).
   **Overdue** lists the two overdue tasks above, the most recent slip first.
   **Today** lists what is due or scheduled today. **Upcoming** has a group
   for each of the next seven days that has something, starting with
   **Tomorrow**. **Later** and **No date** start folded, and **Needs a new
   date** holds the lease renewal. **Done today** is folded at the end.
2. Look at the status bar: it counts what is overdue and due today, and
   leaves out the task that needs a new date. Hover it to read the tasks by
   name.
3. Put the cursor on *Book the monorail maintenance window* and press
   <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd>
   (**Deckard: Toggle Task Done**; <kbd>Ctrl</kbd> for <kbd>Cmd</kbd> on
   Windows and Linux). The box is ticked and a ✅ date written. Press it again
   to reopen the task.
4. Put the cursor on *Measure false positives at clinic entrances* and press
   <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>
   (**Deckard: Edit Task**). Choose **Due**, type `next friday`, and watch the
   box say which day it read before you press Enter. Choose **Write the
   task**.
5. At the end of that line, type a space and `/`. Pick **high priority** from
   the list. Typing `/every` narrows it to repeat rules.
6. Above *Pack the field kit*, the lens reads **███░░░░░░░ Steps 1/3 done
   (33%) · next: Pack the rain shells**; select it to go to that step. Put
   the cursor on *Pack the field kit* and run **Deckard: Break into
   Steps…** (it is on the lightbulb too). Add a step, press Enter, and choose
   **Write**. Then tick the last open step: Deckard offers **Complete Task**.
7. In the Tasks view, right-click **Overdue** and choose **Reschedule All…**.
   Each day it offers says how full it already is. Press Escape to leave the
   dates as they are, or pick one and use **Undo**.
8. In the Tasks view, open **Needs a new date** and use the calendar button
   beside the lease renewal to give it a date.

Next: [[02 Task board]]
