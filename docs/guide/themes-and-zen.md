# Themes and Zen mode

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

## Cards and tags

Two looks you can turn on for every page, in any theme, from **Cards** and **Tags** in a page's gear, or in Settings:

- **Flat cards** (`deckard.display.cardFrames`: `flat`): rows with a divider between them, in place of raised cards. Under the pointer or keyboard focus a row lifts onto the card surface, and its file and line show as they do on a card.
- **Tags as text** (`deckard.display.tags`: `text`): each tag is plain text in the theme's tag color, its `#` or `@` kept, underlined under the pointer, with a focus ring from the keyboard. It still opens its page and has its menu.

Both are yours alone: they're the same in every workspace, and a workspace's settings never change them. In every theme the divider reaches 3:1 against the page and the tag color 4.5:1, which a test checks on each change.

## Zen mode

Zen turns Deckard's chrome down, in any theme. Turn it on with **Zen** in a page's gear, the zen button in a page's title bar, `Deckard: Enter Zen Mode`, or `deckard.zenMode`.

- **Hidden:** decorative labels, the grid backdrop, and the search box's line of syntax; in the editor, the counts above headings, the unlinked-mention lens, the section highlight, and overdue hints.
- **Folded:** each row's file, heading, and line, which come back on hover or focus.
- **Kept:** every button, filter, count, checkbox, and tag, and a task's due date, priority, and overdue marker.

---

← [Renaming, moving, and parking](organizing.md) · [All topics](README.md) · [AI assistants](ai-assistants.md) →
