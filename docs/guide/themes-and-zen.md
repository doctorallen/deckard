# Themes and Display

## Themes

Run `Deckard: Choose Theme…`, or choose **Theme** in any page's gear. Moving through the list previews each theme on the open pages; Enter keeps it, and Escape goes back. The setting is `deckard.theme`.

- **Corpo**, the default, takes its colors and fonts from your VS Code theme, light or dark.
- **Replicant**, **Oblivion**, **LCARS**, **Tomcat**, **Fellowship**, **Synthwave**, and **Cooper** are Deckard's film-inspired styles.

In every theme, red means overdue or high priority, and nothing else.

**Esper Themes** brings these looks to the whole editor, as VS Code color themes, from the same makers. Search for it in the Extensions view, or find it on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=esperinnovations.esper-themes).

| **Corpo** | **Corpo, in a light VS Code theme** | |
| --- | --- | --- |
| <img src="../images/dashboard-corpo.png" alt="Corpo theme Dashboard in a dark VS Code theme." width="220"> | <img src="../images/dashboard-corpo-light.png" alt="Corpo theme Dashboard in a light VS Code theme." width="220"> | |
| **Replicant** | **Oblivion** | **LCARS** |
| <img src="../images/dashboard-replicant.png" alt="Replicant theme Dashboard." width="220"> | <img src="../images/dashboard-oblivion.png" alt="Oblivion theme Dashboard." width="220"> | <img src="../images/dashboard-lcars.png" alt="LCARS theme Dashboard." width="220"> |
| **Tomcat** | **Fellowship** | **Synthwave** |
| <img src="../images/dashboard-tomcat.png" alt="Tomcat theme Dashboard." width="220"> | <img src="../images/dashboard-fellowship.png" alt="Fellowship theme Dashboard." width="220"> | <img src="../images/dashboard-synthwave.png" alt="Synthwave theme Dashboard." width="220"> |
| **Cooper** | | |
| <img src="../images/dashboard-cooper.png" alt="Cooper theme Dashboard." width="220"> | | |

## Display

How much a page draws is one switch, **Zen**, the same on every page; see [Zen](#zen) for where to turn it on. With Zen on:

- **Plain styling**: thin frames, without each theme's grid, corners, glow, codes, or display headings, and no capitals or letter-spacing on headings, buttons, or tabs, two heading sizes kept. DECKARD ▾ stays. Text from your notes is never set in capitals or letter-spaced, in any theme, with Zen on or off: a note's title and headings, its tables, query results and embeds, Linked from, and the tag a search page is about.
- **No help text**: the lines that teach are hidden, such as the search box's line of syntax, the builder's paragraph, Refine's line on Alt- and Shift-click, the Graph's *Open a note to draw the graph around it.*, why Context lists a result, and an empty board column's line on dragging. What a line says is there stays: an empty place keeps its state, such as *No tasks.* or *No tags indexed yet.*, and loses only how to fill it; where Task Statuses saves, and a search that fails to parse, stay too.
- **Compact spacing**, and **flat cards**: rows parted by a divider, which lift onto the card surface under the pointer or keyboard focus.
- **Tags as text**: where tags are listed on their own, such as a note card's tags and Refine, each is plain text in the theme's tag color, its `#` or `@` kept, rather than a framed chip. A tag inside a task's title is always text.

Zen never hides data. Every count beside a name, such as a widget's total, a group's count, a board column's tasks, or a tab's results, shows with Zen on or off, and a due date is written in full, "Overdue 2 days · 2026-10-02". Zen changes no color, and removes no button or filter. In every theme the flat cards' divider reaches 3:1 against the page and the tag color 4.5:1, which a test checks on each change.

**Page width**, its own row in the gear under Theme, keeps pages *Limited* to a column at most 1000px wide, or makes them *Full*, the panel's full width, for a wide monitor. Zen never changes it, and every page keeps the width you chose last. The Task Board and the Calendar always use the panel's full width, so their gears have no Page width row.

**Card details** (`deckard.display.cardDetails`) says which details an entry shows on the line it keeps for them under its dates, with Zen on or off: where it is written, then its created and updated dates, on one line cut short. The line shows while the pointer is on the entry or it has focus, and always on a touch screen; it keeps its room either way, so nothing moves and nothing is covered. Untick all three for none: no line is kept, and a screen reader still reads where it is written.

Every Display setting is yours alone: it's the same in every workspace, and a workspace's settings never change how your pages look.

### Dates

Deckard writes every date it shows you in one format, `YYYY-MM-DD` unless you set another: on pages, in the Tasks view and the editor's lenses, in Find, the task editor, the date box, completions, and every message that names a day. `Deckard: Choose Date Format…` shows today in a few formats, such as `DD/MM/YYYY`, `D MMM YYYY`, and `ddd, MMM D, YYYY`, and **Custom…** says today back in a format as you type it. The format is `deckard.display.dateFormat`.

A format is written with the tokens Obsidian's daily notes, Templater, and Periodic Notes use, so one copied from a vault works here unchanged:

| Token | Writes | Token | Writes |
| --- | --- | --- | --- |
| `YYYY` / `YY` | 2026 / 26 | `Q` | 4, the quarter |
| `M` / `MM` | 10, 01 padded | `MMM` / `MMMM` | Oct / October |
| `D` / `DD` | 2, 02 padded | `Do` | 2nd |
| `ddd` / `dddd` | Fri / Friday | `dd` | Fr |
| `W` / `WW` | the ISO week | `w` / `ww` | the week, from `deckard.calendar.weekStart` |
| `DDD` | 275, the day of the year | `E` | 5, Monday 1 |
| `L` | 10/02/2026, as your display language writes it | `LL` | October 2, 2026 |

The rest of Moment's tokens work too: `Qo`, `Mo`, `do`, `wo`, and `Wo` ordinals, `GGGG` and `gggg` week years, `DDDD`, `H`, `h`, `k`, `m`, `s`, `A`, `a`, `X`, `x`, and `l` to `llll`. A date in a note has no time, so a time reads 00:00; only a note's created and updated dates have one.

Text in `[brackets]` is written as it is, so `[Week] W` writes *Week 40*; any other character is written as it is too. Names are English, as the rest of Deckard is, and `L` and `LL` follow VS Code's display language. A format that is empty, or writes no part of a date, reads as `YYYY-MM-DD`.

Where a day has little room, as the Tasks view's day headings, the Pages view, the calendar's day title, search completions, and Linked from, it's written in `deckard.display.shortDateFormat`, `ddd, MMM D` unless you set another, such as `ddd D MMM`. A day in another year is written in the full format, so a short format needs no year. Where Deckard names the weekday beside a date, as the task editor's *Friday 2026-09-25*, it leaves the weekday out when your format writes one.

What Deckard writes into your notes stays `YYYY-MM-DD`: task dates such as `📅 2026-10-02`, daily note names, reviews, inserted links, searches such as `due = 2026-10-02`, exports, and what the AI assistant's tools give and take. A numeric date typed into a date box is read day first when your format writes the day first, as `DD/MM/YYYY` does.

## Zen

Zen is one checkbox, **Zen** in any page's gear, and one command, `Deckard: Toggle Zen`; the Zen button in a page's title bar turns it on or off too. The setting is `deckard.display.zen`.

- **Hidden:** decorative labels, the grid backdrop, the eyebrow's trail, and every line that teaches, such as the search box's line of syntax; cards are flat and tags are text.
- **Kept:** every button, filter, checkbox, and tag, every count beside a name, and a task's due date written in full, with its priority and overdue marker. Zen never hides data.

Deckard's Zen quiets Deckard's pages; VS Code's Zen Mode (`⌘K Z`, or `Ctrl+K Z`) hides the workbench around them, and the two combine.

---

← [Renaming, moving, and parking](organizing.md) · [All topics](README.md) · [AI assistants](ai-assistants.md) →
