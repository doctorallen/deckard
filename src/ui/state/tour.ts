/**
 * The Tour (plan 48, section 4): fifteen scenes on the work sample, the
 * crew of the Petrel. A scene opens a real page or note, rings one thing
 * on it, and gives the reader one step to try, which is seen to be done
 * from the files the step changes. Nothing here draws a page; the scenes'
 * words narrate the sample, and each points at the guide for the rest.
 *
 * File paths are the sample's, from its folder; `{today}` is today's daily
 * note, `YYYY-MM-DD.md`.
 */

/** The Tour's chapters, in order. */
export const TOUR_CHAPTERS = ['The daily note', 'Tags and people', 'Tasks', 'Types', 'Hubs', 'Wrapping up'] as const;

/** A chapter, by name. */
export type TourChapter = (typeof TOUR_CHAPTERS)[number];

/** How a scene opens its page: a note at a line, or a command. */
export type TourOpen =
  | { kind: 'note'; file: string; at?: string }
  | { kind: 'command'; command: string; args?: readonly string[] };

/** What a scene rings: a line of the note it opened, or something on a page, by `data-help-id` or by its words. */
export type TourRing =
  | { kind: 'line'; text: string }
  | { kind: 'page'; id?: string; text?: string };

/**
 * When a scene's step is done:
 * - `tick`: when the reader ticks it, or its Do it runs;
 * - `line`: when a line of `file` holds every word of `all`, without case;
 * - `changed`: when the line of `file` that holds `text` is no longer what it was when the scene began;
 * - `opened`: when a note whose path, from the sample's folder, matches `pattern` is opened.
 */
export type TourDone =
  | { kind: 'tick' }
  | { kind: 'line'; file: string; all: readonly string[] }
  | { kind: 'changed'; file: string; text: string }
  | { kind: 'opened'; pattern: string };

/** What a scene's Do it does: a command, the hover over some words, or the lightbulb on a line. */
export type TourDo =
  | { kind: 'command'; label: string; command: string }
  | { kind: 'hover'; label: string; text: string }
  | { kind: 'lightbulb'; label: string; text: string };

/** One scene. */
export interface TourScene {
  /** Its id, kept with what is done. */
  id: string;
  chapter: TourChapter;
  title: string;
  /** What it says, with **bold** for names the page shows. */
  body: string;
  /** For a presenter: what to say or show, kept off the audience's screen. */
  note: string;
  /** Whether a first look may skip it. */
  optional?: boolean;
  /** What it opens, in order. */
  open: readonly TourOpen[];
  ring?: TourRing;
  /** The step to try, with **bold** for what to look for. */
  step: string;
  done: TourDone;
  do?: TourDo;
  /** The guide section with the rest, as `page#anchor`. */
  guide: string;
  /** The entry of the page's help map it shows, for This page's Tour chip. */
  helpEntry?: string;
}

const TODAY = '{today}';

/** The scenes, in order. */
export const TOUR_SCENES: readonly TourScene[] = [
  {
    id: 'today',
    chapter: 'The daily note',
    title: 'Start in today’s note',
    body: 'You are **Rhea Calder**, captain of the **Petrel**, a small survey and hauling ship. Each day has a note named for its date, made from your template. Write the way you already do: lines, tasks, tags, and people. Everything else in Deckard reads from notes like this one.',
    note: 'Everything aboard today is one Markdown file in a folder. Nothing in their own workspace changed.',
    open: [{ kind: 'note', file: TODAY, at: '## Morning briefing' }],
    ring: { kind: 'line', text: '## Morning briefing' },
    step: 'Press **Cmd+Shift+Alt+D** (**Ctrl+Shift+Alt+D**) from anywhere to come back to today’s note.',
    done: { kind: 'tick' },
    do: { kind: 'command', label: 'Open today’s note', command: 'deckard.createDailyNote' },
    guide: 'daily-notes#daily-notes',
  },
  {
    id: 'tags',
    chapter: 'Tags and people',
    title: 'Tags gather everything',
    body: 'A **#tag** gathers every line that carries it, in every note. A slash makes a namespace: **#contract/relay-survey**, **#system/reactor**, **#team/engineering**. Namespaces sort tags into kinds, so Deckard can list every contract or every ship system, and a plain tag like **#follow-up** still works.',
    note: 'The slash is the whole trick: contract/, system/, team/ are kinds of thing.',
    open: [{ kind: 'note', file: TODAY, at: '#contract/relay-survey' }],
    ring: { kind: 'line', text: '#contract/relay-survey' },
    step: 'Point at **#contract/relay-survey**: its kind, its hub, and how much carries it.',
    done: { kind: 'tick' },
    do: { kind: 'hover', label: 'Show the hover', text: '#contract/relay-survey' },
    guide: 'notes-and-links#tags-and-people',
  },
  {
    id: 'people',
    chapter: 'Tags and people',
    title: '@ is for people, # is for things',
    body: '**@juno-achterberg** is a person. People get their own page, a card with their role and team when you point at them, and they can be who a task is for. **@juno** and **#juno** are different tags, so use **@** for people and **#** for everything else.',
    note: 'Same idea, different marker. People get a page, a card, and tasks that are theirs.',
    open: [{ kind: 'note', file: TODAY, at: '@juno-achterberg:' }],
    ring: { kind: 'line', text: '@juno-achterberg:' },
    step: 'Point at **@juno-achterberg** for Juno’s role, team, and who Juno reports to.',
    done: { kind: 'tick' },
    do: { kind: 'hover', label: 'Show the hover', text: '@juno-achterberg' },
    guide: 'notes-and-links#tags-and-people',
  },
  {
    id: 'search',
    chapter: 'Tags and people',
    title: 'Every tag is a search',
    body: 'A tag’s page is a search. Add **is:open** for its open tasks, or type a whole query anywhere, such as **#contract/relay-survey AND due < 7d**. **Refine** lists the tags and people that travel with it; select one to narrow.',
    note: 'Point at Refine: it shows which tags and people travel with this one.',
    open: [{ kind: 'command', command: 'deckard.search', args: ['#contract/relay-survey is:open'] }],
    ring: { kind: 'page', id: 'refine' },
    step: 'Select **@tomas-vey** in **Refine** to keep only Tomas’s tasks.',
    done: { kind: 'tick' },
    guide: 'search#refine',
  },
  {
    id: 'related',
    chapter: 'Tags and people',
    title: 'Related notes find the rest',
    body: 'Open any note and **Related notes**, in the Context view, ranks what else you wrote about the same thing, and says why. A shared tag counts most, tags often written together count some, and links add a little. Tags pay off here without a search.',
    note: 'Read one reason aloud. It says why, not just what.',
    open: [
      { kind: 'note', file: 'decisions/DEC-002 Burn profile.md' },
      { kind: 'command', command: 'deckard.relatedNotes.focus' },
    ],
    step: 'Open the top note in **Related notes**, and read why it is there.',
    done: { kind: 'tick' },
    guide: 'connections#related-notes',
  },
  {
    id: 'add-task',
    chapter: 'Tasks',
    title: 'Add a task in plain words',
    body: 'Say it the way you would say it. A day is a due date, a person is who it is for, and the editor names the note it will write to, today’s unless you choose another. The task is an ordinary checkbox line in that note.',
    note: 'Type it slowly so they see the date and the person picked out.',
    open: [{ kind: 'note', file: TODAY }],
    step: 'In **Add Task**, type **Inspect Dev’s hull patch for @dev-laurent monday** and press Enter.',
    done: { kind: 'line', file: TODAY, all: ['hull patch', '@dev-laurent'] },
    do: { kind: 'command', label: 'Open Add Task', command: 'deckard.addTask' },
    guide: 'tasks#adding-a-task',
  },
  {
    id: 'board',
    chapter: 'Tasks',
    title: 'The Task board',
    body: 'Every open task aboard, as cards in a column for each status. **Lanes**, beside Group, splits the columns by a second axis, such as **#team**. Move a card and Deckard rewrites that one line in the note it came from.',
    note: 'Move it, then open its note beside the board: one line changed, nothing else.',
    open: [{ kind: 'command', command: 'deckard.showTaskBoard' }],
    ring: { kind: 'page', text: 'Recalibrate the survey array' },
    step: 'Drag **Recalibrate the survey array** to **In progress**, or use its **⋯** menu.',
    done: { kind: 'changed', file: 'contracts/Relay survey.md', text: 'Recalibrate the survey array' },
    guide: 'task-board#moving-a-card',
    helpEntry: 'move',
  },
  {
    id: 'calendar',
    chapter: 'Tasks',
    title: 'The calendar',
    body: 'The calendar page lists each day’s tasks: due, scheduled, and repeating, such as the weekly scrubber change. Drag one to another day and its date changes in its note. The Calendar view in the sidebar shows the month, with a dot for each day that has a note.',
    note: 'Same tasks, by day. Dragging changes the date in the note.',
    open: [{ kind: 'command', command: 'deckard.showCalendar' }],
    ring: { kind: 'page', text: 'Hull inspection' },
    step: 'Drag **Hull inspection** to another day.',
    done: { kind: 'changed', file: 'systems/Hull.md', text: 'Hull inspection' },
    guide: 'daily-notes#calendar',
  },
  {
    id: 'owes',
    chapter: 'Tasks',
    title: 'What someone owes you',
    body: 'When a line in today’s note says someone will do something by a day, Deckard offers to track it. **Track** writes a waiting task under the line, for that person, due that day. Their page then lists it under **Juno owes you**, ready for your next one-to-one.',
    note: 'Nobody wrote a task. Deckard noticed a promise, and it will be waiting at the next one-to-one.',
    open: [{ kind: 'note', file: TODAY, at: 'coolant pump rebuild is done' }],
    ring: { kind: 'line', text: 'coolant pump rebuild is done' },
    step: 'Choose **Track** above the ringed line, or click the line and choose **Track as waiting on Juno** from its lightbulb.',
    done: { kind: 'line', file: TODAY, all: ['[w]', 'coolant pump rebuild', '@juno-achterberg'] },
    do: { kind: 'lightbulb', label: 'Show the lightbulb', text: 'coolant pump rebuild is done' },
    guide: 'daily-notes#promises-in-todays-note',
  },
  {
    id: 'type-table',
    chapter: 'Types',
    title: 'Types give notes fields',
    body: 'A note in **Types/** says what a person, a contract, or a ship system is, and which fields it has. The front matter you already write fills them in, and **type = person** lists the whole crew as a table you can sort and group.',
    note: 'Lio and Amara have no notes, yet the table lists them from the notes that mention them, and says so.',
    open: [{ kind: 'command', command: 'deckard.search', args: ['type = person'] }],
    ring: { kind: 'page', text: 'No hub note' },
    step: 'Choose **Group by** **team** in the page’s **⋯**.',
    done: { kind: 'tick' },
    guide: 'databases#a-types-rows',
  },
  {
    id: 'type-board',
    chapter: 'Types',
    title: 'A type as a board',
    body: '**Table | Board**, beside a type’s sort note, shows its rows as cards in columns, one per value of a field: contracts by **state**, ship systems by **keeper**. Drag a card and Deckard writes that field in the row’s front matter.',
    note: 'The same board as tasks, for any type: contracts by state, repairs by system.',
    open: [{ kind: 'command', command: 'deckard.search', args: ['type = contract'] }],
    ring: { kind: 'page', text: 'Medical supply run' },
    step: 'Choose **Board**, then drag **Medical supply run** to **accepted**.',
    done: { kind: 'line', file: 'contracts/Medical supply run.md', all: ['state:', 'accepted'] },
    guide: 'databases#a-board-of-rows',
  },
  {
    id: 'types-tab',
    chapter: 'Types',
    title: 'Every type on one page',
    body: 'Home’s **Types** tab lists every type as one row: what its rows are, how many it has and how many of them have a note, its open tasks, and when one was last mentioned. Select a type to open its rows; the arrow before its name lists them in place.',
    note: 'One page for everything the notes are about: the crew, the contracts, the ship’s systems.',
    open: [{ kind: 'command', command: 'deckard.openTypes' }],
    ring: { kind: 'page', text: 'Contracts' },
    step: 'Select the arrow before **Contracts** to list them here.',
    done: { kind: 'tick' },
    guide: 'home-and-stats#the-types-tab',
  },
  {
    id: 'hub',
    chapter: 'Hubs',
    title: 'Hub notes',
    body: 'A hub note **describes** a tag: the Relay survey note’s front matter says **describes: contract/relay-survey**. The tag’s page then opens with it, its fields, and how far along the tag’s tasks are. Each part of that line searches just those tasks.',
    note: 'A hub is just a note whose front matter says which tag it describes.',
    open: [{ kind: 'command', command: 'deckard.search', args: ['#contract/relay-survey'] }],
    ring: { kind: 'page', text: 'overdue' },
    step: 'Select **overdue** in the line under the hub to see only those tasks.',
    done: { kind: 'tick' },
    guide: 'search-pages#hub-notes',
  },
  {
    id: 'rollover',
    chapter: 'Wrapping up',
    optional: true,
    title: 'Carry unfinished tasks forward',
    body: '**Roll Unfinished Tasks Forward** brings earlier daily notes’ open tasks into today’s, under **Carried over**. To have it happen with each new daily note, set the **Daily Note: Rollover** setting to **move**, or to **migrate** to leave a line behind that links to today.',
    note: 'Optional. Some people want yesterday’s loose ends in today’s note, some do not.',
    open: [{ kind: 'note', file: TODAY }],
    step: 'Run **Deckard: Roll Unfinished Tasks Forward**.',
    done: { kind: 'line', file: TODAY, all: ['carried over'] },
    do: { kind: 'command', label: 'Run it', command: 'deckard.rollTasksForward' },
    guide: 'daily-notes#carrying-unfinished-tasks-forward',
  },
  {
    id: 'review',
    chapter: 'Wrapping up',
    optional: true,
    title: 'Weekly and monthly reviews',
    body: '**Open Weekly Note** and **Open Monthly Note** make the period’s note with a review written in: what you completed, what is still open, what is coming up, and the notes you wrote. **Write a Review** updates it, rewriting only the review.',
    note: 'It is plain Markdown. Run it again and only the review part changes.',
    open: [],
    step: 'Run **Deckard: Open Weekly Note**.',
    done: { kind: 'opened', pattern: '(^|/)week-[^/]+\\.md$' },
    do: { kind: 'command', label: 'Open this week’s note', command: 'deckard.openWeeklyNote' },
    guide: 'daily-notes#writing-a-review',
  },
];

/** The Tour scene that shows a page map's entry, counted from 1, or undefined. */
export function tourSceneFor(helpEntry: string): number | undefined {
  const at = TOUR_SCENES.findIndex((scene) => scene.helpEntry === helpEntry);
  return at < 0 ? undefined : at + 1;
}

/** Today's daily note's path from the sample's folder, for `{today}`. */
export function resolveTourPath(file: string, today: string): string {
  return file === TODAY ? `${today}.md` : file;
}

/** The first line of some text that holds `words`, without case, or undefined. */
export function lineHolding(text: string, words: string): string | undefined {
  const wanted = words.toLowerCase();
  return text.split(/\r?\n/).find((line) => line.toLowerCase().includes(wanted));
}

/** Whether some line of `text` holds every one of `all`, without case. */
export function hasLineWithAll(text: string, all: readonly string[]): boolean {
  const wanted = all.map((word) => word.toLowerCase());
  return text.split(/\r?\n/).some((line) => {
    const lower = line.toLowerCase();
    return wanted.every((word) => lower.includes(word));
  });
}

/** Whether the line holding `words` changed between two versions of a file, or went. */
export function lineChanged(before: string | undefined, now: string, words: string): boolean {
  if (before === undefined) {
    return false;
  }
  const was = lineHolding(before, words);
  return was !== undefined && lineHolding(now, words) !== was;
}

/** A Tour place: the scene shown, and which steps are done, by scene id. */
export interface TourProgress {
  scene: number;
  done: readonly string[];
}

/** What was kept of the Tour, read back safely: anything else starts it over. */
export function readTourProgress(kept: unknown): TourProgress {
  const value = kept && typeof kept === 'object' ? (kept as { scene?: unknown; done?: unknown }) : {};
  const scene = typeof value.scene === 'number' && Number.isInteger(value.scene) && value.scene >= 0 && value.scene < TOUR_SCENES.length ? value.scene : 0;
  const ids = new Set(TOUR_SCENES.map((item) => item.id));
  const done = Array.isArray(value.done) ? value.done.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
  return { scene, done };
}
