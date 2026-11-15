# 48 · Help beside the page, and the Tour

Help is a guide to read. It does not say what is on the page in front of
the reader, what each control there does, or which settings change it, and
a new reader has no guided way through Deckard. This plan docks Help beside
the page that asked for it and gives it three tabs: **This page**, which
explains the page from its own guide sections and changes its settings in
place; **Tour**, a guided path through the work sample for a first look and
for demonstrations; and **Guide**, the guide Help shows today. Mockups: the
"Deckard Tour" artifact, version 5
(https://claude.ai/artifact/Mab8pjqe8HmLKAg97Y4XjD).

The work sample is rewritten for the Tour: six weeks aboard the Corvid, a
small independent ship that takes survey and hauling contracts. Its crew
does repairs, upkeep, burns, and port paperwork; nothing in it is violent.

## Principles

- **The tour draws no pages.** Each scene opens a real page with a command
  Deckard already has and points at one thing on it. Nothing in Help is a
  replica of another page.
- **The guide is the only text.** This page shows guide sections, and
  **Open in the guide** lands on the same section, so the two cannot
  disagree. A page map holds pointers, never prose. The Tour's scenes are
  the one place with words of their own: they narrate the sample.
- **Shared controls are written once.** The search box, Refine, ⋯, and Zen
  each have one guide section; a page adds only the sentence of its own
  guide that names the control, such as the board's *Refine counts only
  tasks*.

## 1. Help beside the page

Help on this page, in a page's ⋯, opens Help in the editor group beside the
page (`ViewColumn.Beside`), on **This page** when the page has a map and on
**Guide** at the page's section otherwise. `Deckard: Open Help` and links
from the walkthrough open it where they did, on **Guide**.

Help's page bar gains a tab row, **This page · Tour · Guide**. The guide's
contents rail belongs to Guide; the other tabs use the whole width. The
tab shown is kept with Help's saved state.

The page that asked is passed with the request: `openHelp(section, page)`
in the shared handlers runs `deckard.showHelp` with `{ forPage }`.

## 2. This page

Drawn by the host, as the guide is, from three sources:

1. **The page map** (`src/ui/state/pageHelp.ts`): for each thing on the
   page, its id, its kind (*what you can do* or *control*), the guide
   section it is (`task-board#lanes`), optionally a sentence of another
   section that names it on this page, its settings, and its choice.
2. **The guide**, rendered as for the Guide tab and cut into sections at
   its headings (`guideSections.ts`). An entry's name is its section's
   heading, its body the section, and its line in the list the section's
   first sentence.
3. **The settings**, from the extension's own `contributes.configuration`:
   label, description, kind, and allowed values; the current value and
   where it is set from `inspect`.

The tab lists **What you can do here**, **Controls**, and **Settings that
change this page**. Selecting an entry shows its section, the page's own
line about it, its choices, and its settings, with **Show me** and **Open
in the guide**.

**Choices.** Group, Lanes, Sort, and Board | Table are the board's own
preferences; Help writes them through the same `TaskLayoutService` the board
does, and every open board redraws. **Can start now** is a term of the
board's search; Help asks the board panel to toggle it.

**Settings.** A boolean is a checkbox, an enum a select, a number or string
an input, an object of booleans (`display.cardDetails`) a checkbox per
property. Anything else shows its value with **Open in Settings**;
`tasks.statuses` offers **Edit statuses…**. A write goes where the value is
already set (`settingTarget`), and Zen through `setZenMode`, as the page's
own ⋯ does. The tab is drawn again when a setting or a preference changes.

**Pointing at something.** **Point at something** puts the page beside
into explore mode: each element with a `data-help-id` shows it can be
picked, and a click on one selects its entry in Help instead of acting.
Escape, or the button again, ends it.

**First map: the Task board.** Other pages show their guide section until
they get a map.

## 3. Spotlight and explore, on every page

Two host-to-page messages, handled once in `installSharedBehavior`, so
every page on `startPage` has them (Notes Graph calls the installer itself):

- `spotlight { id?, text? }`: rings the element with `data-help-id="id"`,
  or the smallest element whose text includes `text`, for a few seconds.
- `explore { on }`: marks every `[data-help-id]` element pickable and
  routes a click on one to `helpPicked { id }`.

`helpPicked` is not part of any page's protocol. `WebviewHost` answers it
before narrowing, for every page, and hands it to the open-pages registry
(`pageRegistry.ts`), which every attached host joins and leaves. Help and
the Tour post `spotlight` and `explore` through the registry to every
visible Deckard page; only a page that has the target acts. The attribute
is `data-help-id` because `data-help` already marks the body under Zen.

The ring is a class, `help-spotlight`, with an outline in `--focus` and a
pulse that stops under reduced motion.

## 4. The Tour

`src/ui/state/tour.ts` holds the scenes: chapter, title, narration, a
talking point for presenters, what to open, what to ring, the step to try,
and how the step is seen to be done. `TourService` keeps the scene and what
is done in the workspace's state and runs a scene:

1. Help is shown beside, on Tour.
2. The first editor group takes focus, and the scene's page is opened
   there: a note at a line, or a command.
3. The ring: a line in a note gets a decoration until the scene changes; a
   page gets `spotlight`.
4. The step is done when its file holds a text or no longer holds one, when
   the line holding a text changes, when a file is opened, or when its
   **Do it** button runs; otherwise the reader ticks it.

The Tour runs only in the work sample's folder; elsewhere the tab offers
**Create a Work Sample**.

Scenes, in order: today's note; tags and namespaces; `@` for people and `#`
for things; every tag is a search; Related notes; Add Task in plain words;
the Task board; the calendar; what someone owes you; types as a table; a
type as a board; hub notes; the Hubs view; and, optional, carrying tasks
forward and weekly and monthly reviews.

**Presenting.** **Present** runs the scenes ticked for the demo. A status
bar item names the scene and carries its talking point in its tooltip;
`Deckard: Next Tour Scene`, `Previous`, and `End Presenting` have keys while
presenting (Ctrl+Alt+] and Ctrl+Alt+[). With **Hide Help while presenting**,
Help closes so the page has the window, and the keys and the status bar run
the tour. Nothing advances by itself.

`Deckard: Take the Tour` opens Help on Tour. Get Started gains a last step,
**Take the tour**, and the sample's README says to run it.

## 5. The guide

`task-board.md` gives each control a section of its own, so a page map can
point at it: Moving a card, Can start now, Keeping a search, Adding a task,
Work-in-progress limits, Sorting and ranking, and A card's menu are split
from bullets, the board's ⋯ menu gets a section, and Keyboard and the limits
open with a sentence that works as a summary. A new page, **Help and the
tour**, says what This page, Point at something, and the Tour do.

## 6. The sample

Replaces the team lead's week. Crew: Rhea Calder, captain (`deckard.me`);
Juno Achterberg, chief engineer; Dev Laurent, mechanic; Tomas Vey, pilot;
Ottilie Brandt, comms and contracts; Lio Marsh, a new deckhand with no note;
Amara Kibet, a broker at Pallas Yard. Namespaces `#contract/`, `#system/`,
`#team/`, `#port/`, `#meeting/`. Types Person, Team, Contract (state:
bidding, accepted, underway, delivered), System, Decision, and Term.

## Decisions

- **D1. No ? button.** Help on this page stays a row of ⋯ on every page; a
  button in every page bar would change every page for one entry point.
- **D2. The Tour's words live in `tour.ts`,** not the README: they narrate
  the sample, and the README stays a page to read without the Tour.
- **D3. The presenter bar is the status bar.** A webview cannot draw over
  another, so the slim bar of the mockup is a status bar item and keys.
- **D4. `helpPicked` is answered by the host base,** not each page's
  protocol, so a page joins explore mode by carrying `data-help-id` alone.
- **D5. No new screenshot baselines.** The new Help tabs are covered by
  page and host tests and the rendered contrast suite. The same change
  retires the whole-page DOM goldens and cuts the screenshot baselines to a
  short Linux set (see [testing](../architecture/testing.md)).

## Tests

- `guide-sections.test.ts`: cutting a rendered page at its headings; first
  sentences.
- `page-help.test.ts`: every map entry's guide section exists, its other
  sentence names it, its settings are contributed, and its `data-help-id`
  is drawn by the page.
- `spotlight.test.ts`: a page rings by id and by text, and in explore mode
  routes a click to `helpPicked`.
- `help-page.test.ts`, `help-host.test.ts`: tabs, This page's actions, the
  setting writes and their targets.
- `tour.test.ts`: every scene's command is contributed or built in, every
  file and text it names is in the sample, and the done rules.
- `sample-workspace.test.ts`, `sample-work-types.test.ts`: the new sample.

## As built

- **Help's page stays host-drawn.** This page and the Tour are HTML the
  host builds (`thisPageHtml.ts`, `tourHtml.ts`) and posts as `helpPanel`
  when their tab shows, as the guide's pages are; the page script only
  switches tabs and sends `helpTab`, `helpAction`, and `helpSetting`.
- **The guide is cut on the host** (`guideSections.ts`): each rendered page
  is split at its headings' anchors, and an entry's name, words, and line
  in the list come from its section. The board's line about a shared
  control is the sentence of its section that names the control.
- **`openHelp` passes the page's name** (`PageContext.name`), so every
  page's Help on this page opens Help beside it; only the Task board has a
  map, and the others open on Guide.
- **Settings** are read from `contributes.configuration` and written with
  `settingTarget` and `writeSetting`; `display.zen` goes through
  `setZenMode`. `board.limits` and `tasks.statuses` are not edited in
  place. The label is the Settings editor's (`ui/state/settingLabel.ts`,
  moved out of `notify.ts` so Help's settings module needs no `vscode`).
- **Can start now** is toggled through `TaskBoardPanel.toggleAvailable`,
  which applies the board's own search with `is:available` added or taken
  out.
- **The Tour ticks a step** when a line of its file holds every word named
  (`line`), when the line holding its words changed since the scene began
  (`changed`), or when a note matching a pattern opens (`opened`); a scene
  without one is ticked by its **Do it** or by hand. A page ring is sent
  three times while the page draws, held until the scene changes.
- **The sample's terms** are EVA, RCS, and TCM: Deckard counts terms
  written in capitals, so Delta-v, Burn window, and Scrubber could not be.
  A System's keeper is `keeper` (reverse `keeps`), since `owner` is a
  built-in search field. The contract template is `templates/contract.md`,
  the name New Note from Type reads. The Hubs view's groups come from the
  namespaces: Contracts, People, Systems, Teams.
- **The people table's scene rings "No hub note"**, the words the table
  writes beside a person with no note; the sample has two, Lio Marsh and
  Amara Kibet.

