# 22 · Display in place of Zen

Zen is one switch that does several jobs at once. This replaces it with a
**Display** scale of three steps, Full · Quiet · Zen, over a few settings
that can each be set on their own, plus four preferences the scale never
moves and two looks a reader turns on themselves. The proposal, reviewed by
three UX reviewers, is at
https://claude.ai/artifact/NE1pW4hh8cMkoVgpriqhtc (version 9); this is the
plan that builds it.

## The model

| Setting (`deckard.display.*`) | Values | Moved by the scale |
| --- | --- | --- |
| `level` | `full` · `quiet` · `zen` | The scale itself |
| `themeStyling` | `auto` · `styled` · `plain` | Plain from Quiet |
| `helpText` | `auto` · `shown` · `hidden` | Hidden from Quiet |
| `density` | `auto` · `comfortable` · `compact` | Compact at Zen |
| `counts` | `shown` · `hidden` | Never: a preference |
| `fileAndLine` | `hover` · `always` · `never` | Never: a preference |
| `dates` | `both` · `relative` · `date` | Never: a preference |
| `pageWidth` | `column` · `wide` | Never: its own gear row |
| `cardFrames` | `raised` · `flat` | Never: set by the reader |
| `tags` | `chips` · `text` | Never: set by the reader |

- Every `deckard.display.*` setting is **application** scope: display is
  personal, so a committed workspace file can't decide how someone else's
  pages look, and Reset can't miss a pin in another scope.
- **One resolver**: a scale setting that isn't `auto` wins; otherwise the
  step decides. Zen at the scale draws pages exactly as `deckard.zenMode`
  does today, with one difference: DECKARD ▾ stays.
- **The page shell marks the body** with one attribute per resolved value
  (`data-styling`, `data-help`, `data-density`, `data-counts`,
  `data-file-line`, `data-dates`, `data-width`, `data-cards`, `data-tags`),
  only when it isn't the default, in place of `body.zen`.

## Phases, one commit each

1. **Flat cards and text tags.** The two settings, carried through the
   chrome to every page's body, the gear's Cards and Tags rows, and their
   sheets: a `--divider` token at 3:1 against the panel in every theme
   (Replicant and Corpo their own values), flat rows lifting onto the card
   surface under the pointer and keyboard focus (hover lays the carried-down
   line over the next row, focus pushes it down), high contrast keeping its
   `contrastBorder`; tags as text in a `--tag-text` token checked per
   theme, the `#` and `@` kept, 24px targets, underline on hover, a focus
   ring from the keyboard.
2. **The scale.** `level`, `themeStyling`, `helpText`, `density`, the
   resolver, the body attributes, and `zen.css` split into three sheets.
   Sentence-case headings keep two sizes. Reduce motion stills the hover
   slide's transform too.
3. **The preferences.** Counts, File & line, and Dates, written by each page
   from what its snapshot carries, the hidden form kept as visually hidden
   text (never an `aria-label` on a span), and an overdue date always
   saying "Overdue".
4. **Page width.** Column or Wide, its own gear row under Theme.
5. **Moving from Zen.** `deckard.zenMode` read as an alias for `level: zen`
   and kept registered with a deprecation message; Zen's editor half (the
   reference counts, the unlinked-mention lens, the due hints, the section
   highlight, and the Sections counts) becomes five explicit settings,
   written off only where the reader hasn't set them; one notice. The
   title-bar Zen button and `Deckard: Toggle Zen` go to Zen and back to the
   step the reader was on, or to Full; Enter and Leave Zen Mode stay as
   commands.
6. **The gear and the quick pick.** The gear's Zen row becomes Display: three
   pressed buttons, then "Quiet · 2 changed · Use Quiet's values" and
   Customize…, which opens Settings filtered to `deckard.display`.
   `Deckard: Choose Display…` lists the steps (previewed as Choose Theme…
   does), Use the step's values, Customize…, and Choose Editor Preset….
7. **Tests and docs.** Full, Quiet, and Zen in every theme; Zen in high
   contrast dark and light; a hovered and a focused row at Zen; Page width
   Wide; flat cards and text tags in every theme for contrast; DOM snapshots
   for each preference value; a 240px sidebar at 200% zoom. The guide's
   Themes and Zen page becomes Themes and Display; settings, Help, the
   walkthrough, and the changelog follow.

## Decisions taken (logged for review)

- Ornament and Headings are one setting, **Theme styling**, for a first
  version; a separate Headings setting comes back if anyone asks.
- The sidebar views follow Density, keeping 24px targets.
- Flat cards and text tags ship as looks a reader turns on (David's choice
  B for both), with the fixes above.
