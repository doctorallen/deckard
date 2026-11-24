/**
 * Today's top tasks on the Task board (docs/implementation/50-top-three.md):
 * the strip above the columns, and the row of a card's menu that adds a
 * task to the picks or takes it out. What the host and the page both say
 * of them is here, so neither words it apart from the other; it imports
 * nothing, since a page bundles it.
 */

/**
 * The strip's id where a column's would be: on its cards, in their keys,
 * and as the place a card dropped on it is moved to.
 */
export const TOP_STRIP_ID = 'top';

/** What a card's or a row's menu state holds when its task is one of today's picks. */
export const TOP_MOVE = 'top';

/** The value of the menu's row that adds the task to today's picks, or takes it out. */
export const TOP_MENU_VALUE = 'toggle-top';

/** The key that does the same on a focused card. */
export const TOP_KEY = 'p';

/** The menu row's words: **Add to today's top three**, or **Remove from today's top three** on a pick. */
export function describeTopMenu(name: string, picked: boolean): string {
  return `${picked ? 'Remove from' : 'Add to'} today's ${name.toLowerCase()}`;
}

/** How a strip's head, or the table's group, counts the day: how many picks are done, and how many the search shows. */
export interface TopCount {
  /** Picks done today, of every pick. */
  done: number;
  picked: number;
  /** Picks drawn: fewer than `picked` when the board's search leaves some out. */
  shown: number;
}

/** The count beside the strip's name: `1/3 done`, and `· 2 of 3 shown` when the search leaves a pick out. */
export function describeTopCount({ done, picked, shown }: TopCount): string {
  return `${done}/${picked} done${shown < picked ? ` · ${shown} of ${picked} shown` : ''}`;
}

/** The strip as a screen reader names it: `Top three, 1 of 3 done, 2 of 3 shown`. */
export function speakTopCount(name: string, { done, picked, shown }: TopCount): string {
  return `${name}, ${done} of ${picked} done${shown < picked ? `, ${shown} of ${picked} shown` : ''}`;
}
