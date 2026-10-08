# Task board

The Task board lays tasks out in columns and rewrites a task when you move
its card. It groups by **Status**, **Priority**, **Due date**, **Person**, or
any tag namespace with **Tag…**. This note holds tasks with a status, a
person, a dependency, and a context, so each grouping has something in it.

## How the tasks below are written

A status is the character in a task's box: `[ ]` to do, `[/]` in progress,
`[w]` waiting, `[s]` someday, `[=]` blocked, `[x]` done, and `[-]` cancelled.
The board gives each status a column, its character beside its name, as
**In progress [/]**. The gear says which statuses are columns and in what
order. This sample's settings put a limit of 2 on In progress, so that
column reads **3 / 2** with an outline.

Who a task is for goes in its 👤 field. Naming a person in the words only
mentions them; the field says whose task it is. This sample's settings say
you are Juno Hale (the setting is `deckard.me`), so a task whose 👤 names
Juno is yours.

A task can wait for another: the one that comes first gets an id with 🆔, and
the one that waits names it with ⛔. The waiting task is **blocked** until the
first is done.

## Relay receivers #project/ghostline-relay

- [/] Calibrate the three receivers 👤 #person/ren-kade 🆔 calibrate
- [ ] Run the passive-ping comparison 👤 #person/ren-kade ⛔ calibrate
- [w] Hear back from Praxis Loom on audio retention #contact/praxis-loom
- [ ] Review the receiver contract with counsel 👤 #person/juno-hale
- [ ] Ask Leena to audit the activation log [assignee:: #person/leena-sato]
- [s] Try a second vendor for the lens coating
- [/] Go over the shell-camera frames with #person/ivo-chen
- [-] Book a second shell camera for the north exits ❌ {{date-2}}

## What each task shows

Reading down the relay list:

- *Calibrate the three receivers* is Ren's, and is being done. It **blocks**
  the comparison, which is Ren's too.
- *Hear back from Praxis Loom* is **waiting**, `[w]`, so it is left out of
  **Can start now**. So is the second-vendor idea, which is someday, `[s]`.
- *Review the receiver contract* is yours. *Ask Leena* is Leena's, written in
  the Dataview format.
- *Go over the shell-camera frames* mentions Ivo but is for nobody in
  particular, so it counts as yours too. Its `[/]` says it is in progress,
  as the calibration's does: the board puts both under In progress.
- *Book a second shell camera* is cancelled: `[-]` closes it without doing
  it, and ❌ says when. It counts as neither open nor done.

Contexts say where a task can be done. Group the board or the Tasks view by
the context namespace and each context gets its own list. The last errand
below has two contexts, so it is in both lists.

## Errands by context #team/wardens

- [ ] Call the clinic about the dawn route #context/phone
- [ ] File the custody sketch #context/desk
- [ ] Walk the South Spindle stairs before dawn #context/field
- [ ] Photograph the flooded exits and upload them #context/field #context/desk

## Try it

1. Run **Deckard: Open Task Board**. It opens grouped by **Status**, on
   `is:open`. Drag *Try a second vendor* from **Someday** to **Todo**, then
   look at the line above: its `[s]` is now `[ ]`.
2. Look at **In progress**: its header reads **3 / 2**, the limit this sample sets.
3. Choose **Person** in the grouping switch. Ren has two cards, Leena one,
   Juno one, and everything else is under **Nobody named**. Drop a card on
   another person to hand it over.
4. Press **Can start now**. The blocked comparison, the waiting and someday
   tasks, and the falloff test in the Tasks note, which has not started, drop
   off the board. Press it again to go back.
5. Choose **Tag…** and pick `context`. There is a column for each context,
   and the photograph task is in two of them.
6. Focus a card and press **?** to list the keys: **x** completes it, **t**
   and **m** make it due today or tomorrow, **1** to **5** set its priority,
   **e** opens the task editor, and **s** breaks it into steps.
7. Complete *Calibrate the three receivers* (press **x** on its card). The
   comparison is no longer blocked. Undo puts it back.
8. Open the gear. Under **Status columns**, clear **Someday** to hide its
   column, and drag **Waiting** above **In progress**. Then choose
   **Table**, and add **status** and **blocked** under **Columns**. Select a
   column header to sort by it.
9. In the Tasks view, run **Deckard: Group Tasks By…** from its title bar,
   choose **Tag namespace…**, and type `context`. The same lists appear in
   the sidebar. Choose **Due status** to go back.

Next: [[03 Repeats and dates]]
