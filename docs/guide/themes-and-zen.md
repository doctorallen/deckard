# Themes and Display

## Themes

Run `Deckard: Choose Theme…`, or choose **Theme** in any page's gear. Moving through the list previews each theme on the open pages; Enter keeps it, and Escape goes back. The setting is `deckard.theme`.

- **Corpo**, the default, takes its colors and fonts from your VS Code theme, light or dark.
- **Replicant**, **Oblivion**, **LCARS**, **Tomcat**, **Fellowship**, **Synthwave**, and **Cooper** are Deckard's film-inspired styles.

In every theme, red means overdue or high priority, and nothing else.

**Esper Themes** brings these looks to the whole editor, as VS Code color themes, from the same makers. Deckard suggests it once, after its first index, on a machine without it; the [Marketplace](https://marketplace.visualstudio.com/items?itemName=esperinnovations.esper-themes) has it any time.

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

How much a page draws is a scale of three steps. Pick one with **Display** in a page's gear, `Deckard: Choose Display…`, which shows each step on the open pages as you move through the list, or `deckard.display.level`. Each step keeps what the one before it took away:

| Setting (`deckard.display.…`) | Full (default) | Quiet | Zen |
| --- | --- | --- | --- |
| **Theme styling** (`themeStyling`) | Styled | Plain | Plain |
| **Help text** (`helpText`) | Shown | Hidden | Hidden |
| **Tags** (`tags`) | Chips | Text | Text |
| **Density** (`density`) | Comfortable | Comfortable | Compact |
| **Cards** (`cardFrames`) | Raised | Raised | Flat |
| **Counts** (`counts`) | Shown | Shown | Hidden |
| **File & line** (`fileAndLine`) | On hover | On hover | Never |
| **Dates** (`dates`) | Both | Both | How far off |

- **Theme styling**: *styled* keeps each theme's grid, corners, glow, codes, and display headings; *plain* draws thin frames and sentence-case headings, two sizes kept. DECKARD ▾ stays either way.
- **Help text**: the lines that teach, such as the search box's line of syntax and Home's key bar. A search that fails to parse always says so.
- **Tags**: where tags are listed on their own, such as a note card's tags and Refine, framed *chips* or plain *text* in the theme's tag color, its `#` or `@` kept. A tag inside a task's title is always text.
- **Density**: *comfortable* or *compact* spacing.
- **Cards**: *raised* cards, or *flat* rows parted by a divider, which lift onto the card surface under the pointer or keyboard focus.
- **Counts**: the number beside a name, such as a widget's total, a group's count, a board column's tasks, or a tab's results. Figures that are the point, such as Home's Due today and a calendar day's counts, always show.
- **File & line**: where an entry is written, under it on *hover* and focus, *always* under every entry, or *never*.
- **Dates**: a due date written *both* ways, "Overdue 2 days · 2026-10-02", only how far off (*relative*), "Overdue 2 days", or only the *date* with its state, "Overdue · 2026-10-02". An overdue date always says Overdue, and a date over a month away keeps its date.

Each setting follows the step while it's *Auto*; set one and it stays as you set it at every step. The gear then says so, such as *2 changed · Reset · Customize…*: **Reset** puts the step's own values back, and **Customize…** opens Settings on Display, where each one you changed shows as Modified with its own Reset. None of them changes a color, and none removes a button or filter; whatever is out of sight stays in the page for a screen reader, which hears every count, file, and date in full. In every theme the flat cards' divider reaches 3:1 against the page and the tag color 4.5:1, which a test checks on each change.

**Page width** (`deckard.display.pageWidth`), its own row in the gear under Theme, keeps pages *Limited* to a column at most 1000px wide, or makes them *Full*, the panel's full width, for a wide monitor. The steps never change it. The Task Board and the Calendar always use the panel's full width, so their gears have no Page width row.

Every Display setting is yours alone: it's the same in every workspace, and a workspace's settings never change how your pages look.

## Zen

Zen is Display's last step, one click away from any page: the Zen button in a page's title bar, `Deckard: Toggle Zen`, or `Deckard: Enter Zen` and `Deckard: Leave Zen`. Leaving goes back to the step you were on, or to Full.

- **Hidden:** decorative labels, the grid backdrop, the eyebrow's trail, the search box's line of syntax, counts beside names, and each entry's file and line; cards are flat, tags are text, and a due date says how far off it is.
- **Kept:** every button, filter, checkbox, and tag, and a task's due date, priority, and overdue marker.

### Moving from Zen mode

`deckard.zenMode` is replaced by Display. If you had it on, it becomes the Zen step, which goes further than Zen mode did: cards are flat, and counts and each entry's file and line are left out. **Customize…** sets any of them back. What Zen mode also turned off in the editor is now five settings of its own, turned off for you where you hadn't set them, so you can turn any back on: `deckard.editor.referenceCounts` (the counts above headings), `deckard.editor.unlinkedMentions` (the mention lens), `deckard.editor.taskDueHints` (the overdue and due-today hints), `deckard.highlightNoteSections` (the band behind the section being edited), and `deckard.outline.showCounts` (the task counts in the Outline). One notice says so, once.

---

← [Renaming, moving, and parking](organizing.md) · [All topics](README.md) · [AI assistants](ai-assistants.md) →
