/**
 * Deckard's pages, as one list: what the Pages view shows, what Go to…
 * offers, and in what order. Each page has a glyph of its own, the command
 * that opens it, and a hint drawn from the notes as they are now, so the
 * list says something worth reading as well as where to go.
 */

/** Each page, by the name of its glyph in resources/pages. */
export type DeckardPageId = 'home' | 'board' | 'calendar' | 'today' | 'graph' | 'find' | 'stats' | 'help';

/** One page as the list shows it. */
export interface DeckardPage {
  id: DeckardPageId;
  label: string;
  /** The command that opens it. */
  command: string;
  /** What is worth knowing about it now, such as "3 due today". */
  description: string;
  /** A sentence on what it is, for a tooltip or a quick pick's second line. */
  detail: string;
}

/** What the hints are drawn from. */
export interface PageFacts {
  dueToday: number;
  overdue: number;
  /** How many notes and how many files the index holds. */
  notes: number;
  files: number;
  today: Date;
  /** Whether today's daily note has been written yet. */
  todayNoteExists: boolean;
  /** The key Find is bound to, as the platform writes it. */
  findKey: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `n thing` or `n things`. */
function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** Every page, in the order the Pages view and Go to… list them. */
export function listDeckardPages(facts: PageFacts): DeckardPage[] {
  const day = `${DAYS[facts.today.getDay()]}, ${MONTHS[facts.today.getMonth()].slice(0, 3)} ${facts.today.getDate()}`;
  return [
    {
      id: 'home',
      label: 'Home',
      command: 'deckard.showDashboard',
      description: facts.dueToday > 0 ? `${count(facts.dueToday, 'task', 'tasks')} due today` : 'Dashboard',
      detail: 'What is due today, what slipped, and the widgets you arrange',
    },
    {
      id: 'board',
      label: 'Task Board',
      command: 'deckard.showTaskBoard',
      description: facts.overdue > 0 ? `${count(facts.overdue, 'task', 'tasks')} overdue` : 'Tasks as columns',
      detail: 'Open tasks as columns by status, priority, due date, person, or tag',
    },
    {
      id: 'calendar',
      label: 'Calendar',
      command: 'deckard.showCalendar',
      description: `${MONTHS[facts.today.getMonth()]} ${facts.today.getFullYear()}`,
      detail: 'Dated tasks and daily notes by day; drag a task to another day',
    },
    {
      id: 'today',
      label: "Today's note",
      command: 'deckard.createDailyNote',
      description: facts.todayNoteExists ? day : `${day} · not written yet`,
      detail: "Opens today's daily note, writing it from your template first if needed",
    },
    {
      id: 'graph',
      label: 'Notes Graph',
      command: 'deckard.showNotesGraph',
      description: count(facts.notes, 'note', 'notes'),
      detail: 'Every note, task, and tag connection as a map',
    },
    {
      id: 'find',
      label: 'Find in Notes…',
      command: 'deckard.searchWorkspace',
      description: facts.findKey,
      detail: 'Notes, tasks, tags, and saved searches as you type',
    },
    {
      id: 'stats',
      label: 'Stats',
      command: 'deckard.showStats',
      description: count(facts.files, 'file', 'files'),
      detail: 'What needs attention, the totals, and what you open most',
    },
    {
      id: 'help',
      label: 'Help',
      command: 'deckard.showHelp',
      description: 'Get Started and the guide',
      detail: 'The quick glance, with the full guide a click away',
    },
  ];
}
