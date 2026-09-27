# Repeats and dates

A task with a 🔁 rule comes back. Complete it, from anywhere, and Deckard
writes its next occurrence on the line above, with the dates moved on by the
rule. This note holds a routine for each kind of rule Deckard reads, two
rules it cannot read, and a list of the ways a date can be typed.

## Routines #team/wardens

- [ ] Rotate the relief roster 🔁 every week 📅 {{date+4}}
- [ ] Check the lens calibration log 🔁 every other week 📅 {{date+5}}
- [ ] Hold the joint Harbor and Wardens review 🔁 every month on the second Tuesday 📅 {{date+11}}
- [ ] Give the dawn team a rest day 🔁 every 2 weeks on Monday, Thursday 📅 {{date+6}}
- [ ] Submit the quarterly oversight report 🔁 every quarter 📅 {{month+1}}
- [ ] Clean the rain shells 🔁 every weekend 📅 {{date+3}}
- [ ] Settle the relay site's power bill 🔁 every month on the last Friday 📅 {{date+20}}
- [ ] Restock the clinic's first-aid cabinet 🔁 every 10 days when done 📅 {{date+8}}
- [ ] Renew the parking permits 🔁 every year 📅 {{date+30}}
- [ ] Back up the case ledger [repeat:: every weekday] [due:: {{date+1}}]
- [ ] Water the station ferns 🔁 every tuesdya 📅 {{date+2}}
- [ ] Log the week's overtime 🔁 weekly 📅 {{date+4}}

- *every other week*, *every 2 weeks on Monday, Thursday*, and *every month on
  the second Tuesday* are rules Obsidian Tasks reads too. *every quarter* and
  *every weekend* are Deckard's own.
- *when done* counts from the day you complete the task, not from its due
  date.
- The last two are rules Deckard cannot read: a misspelled weekday and a
  single word. Each is underlined with a warning, because completing it would
  not start the next one.

## Dates in plain words

Every box that asks for a date reads the same words: the task editor, a
date from the Tasks view or the board, a bulk edit, Capture, and
**Deckard: Open Daily Note for Date…**. It says back the day it read before
anything is written, such as *Monday 2026-09-28 · in 3 days*.

```text
today   tomorrow   yesterday           the day named
in 3 days   +2w   3 weeks   1 month    that far ahead
3 days ago   2 weeks ago               that far back
friday   next friday                   the next Friday, never today
last friday                            the Friday before today
oct 3   3 Oct   October 3rd            that day, this year or next
next week                              next week's first day
end of week   end of month   eom       the last day of the week or month
next month   weekend                   the 1st of next month, the coming Saturday
10/3                                   month first in English, day first in German or French
```

A search reads these words too, but there a week or a month means the whole
span: `due = next-week` is every day of next week.

## Try it

1. Complete *Rotate the relief roster*. A new line appears above it, due a
   week later, and the one you completed keeps its ✅ date.
2. Complete *Submit the quarterly oversight report*. The new one is due three
   months later.
3. Put the cursor on `tuesdya` and open the lightbulb
   (<kbd>Cmd</kbd>+<kbd>.</kbd>). Choose **every tuesday**. Do the same on
   `weekly`, which offers **every week**.
4. Put the cursor on *Clean the rain shells*, open **Deckard: Edit Task**,
   choose **Repeats**, and pick another rule, or write your own.
5. Run **Deckard: Capture** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>)
   and type `Call Hush Baird friday p2 every week`. The line it will write is
   shown under the box, with a due date, a priority, and a rule, before
   anything is saved. Press Escape if you would rather not add it.
6. Run **Deckard: Open Daily Note for Date…** and type `yesterday`. It opens
   yesterday's note, which is already in this sample.
7. In the task editor, type `+1m` into **Due**. From January 31 it gives
   February 28: a month is a calendar month.

Next: [[04 Search]]
