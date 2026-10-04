# Fixes

# Improvements

# Features
- Tasks: look into [Obsidian Tasks statuses](https://publish.obsidian.md/tasks/Getting+Started/Statuses) (the character in the box: `[/]` in progress, `[-]` cancelled, and custom ones) in place of `#status/…` tags for the Task board's and the Tasks view's Status columns. Today only ` `, `x`, and `X` are read (`src/ui/state/taskLineMarks.ts`), `[-]` and `[/]` lines are left out of the index without notice, and an Obsidian vault's in-progress tasks go missing from every count; the persona study's Obsidian user found about 400 tasks in Obsidian and about 260 in Deckard. Questions to settle: whether a status character replaces the tag or both are read, how `deckard.board.statuses` maps to characters, what a card dropped on a column writes, which statuses count as done or as cancelled for counts and `is:open`, and how notes already using `#status/…` tags move over.
- Calendar: when a week or month is clicked and Deckard asks whether to create its note, offer **Create Review** as a second action beside creating the note, so the review for that week or month is written from the same prompt rather than by opening the note first and running the review afterwards.

# Themes
