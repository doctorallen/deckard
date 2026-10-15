# 38 · Questions

A question is a line of its own kind. Deckard keeps the open ones in a
list, offers a later line that looks like an answer, and writes the answer
under the question when the reader accepts it. Mockups: the "Four Deckard
Ideas" artifact, idea 3.

## Writing a question (D4)

`- [?] Who approves access to the bond UAT? #team/rates`

- `?` becomes a built-in checkbox status, **Question**, of a new status
  type that is *not a task*, the way `[>]` (moved) is not a task: it is
  never on the Task board, in task counts, `is:open`, Home's Tasks view or
  the status bar. Read how plan 23 (`docs/implementation/23-task-statuses.md`)
  and `src/domain/tasks/taskStatuses.ts` define statuses and where `[>]` is
  excluded, and follow the same path.
- A reader who already gave `?` a status of their own keeps it: their
  setting wins, and questions are then off (say so once, in the log).
- A question's text, tags, mentions, note and line are indexed like a
  task's. It is a new kind of indexed item, `Question`, with an id like a
  task's.

## Answered (D5)

A question is answered when an indented child line under it starts with
`Answer:` (any case). The box stays `[?]`.

`    - Answer: Priya Natarajan, via the RATES-UAT group [[2026-10-14#Access]] (14 Oct)`

## Search

`is:question` (every question), `is:answered`, `is:unanswered`. They work
in Find, search pages, query blocks, saved searches and review sections.
Document them in search.md.

## Offering an answer

When a note is saved, each new or changed line (not a heading, not a
question) is scored against the open questions:

- BM25 over the question's words (the scorer Related Notes already uses,
  `src/domain/...` lexical relevance), stop words and very common words
  weighted down.
- Offered only when the line shares at least three of the question's
  uncommon words, and also a tag or a person when the question has one.
- A question that names a typed row and one of its fields (`who leads
  #team/fx`) is answered from Find's answer tier: the offered answer is the
  field's value, with the hub note as its source.
- **Not it** is remembered for that pair (question id, line text hash) in
  workspace state.
- At most one offer per question is shown (the best).

## Where questions show

1. **The editor.** A CodeLens above an open question: *Question · open 12
   days*, then, when there is one, *1 line may answer it: 14 Oct, Access*
   (opens it), **Answer…**, and **Drop** (rewrites `[?]` as `[-]`). An
   answered one: *Question · answered 9 Oct*. **Answer…** opens a quick
   input: type an answer, or pick the offered line (which writes its text
   and a link to it).
2. **The Questions view (not only Home).** David rarely uses Home, so open
   questions get a tree view in the Deckard sidebar, under Tasks: **Questions**,
   each open question a row (its text; description: age and first tag),
   oldest first, grouped by nothing. A question with an offered answer has
   one child row, *May answer: 14 Oct · Access*, with inline actions **Use
   as answer** and **Not it**. Selecting a question opens its line. The
   view's title bar: **Show answered** toggle, and **Open as search**
   (`is:unanswered`). Its badge is the open count. Collapsed by default when
   empty; it says *No open questions. Write one as `- [?] …`.* when empty.
3. **Home.** An **Open questions** widget (not in the default layout; in
   + Add widget), the same rows and actions as the view.
4. **Find.** When Find finds no full match, its first row offers **Ask it:
   add "…?" to today's note**, which appends `- [?] <the words, as a
   question>` under today's note's questions place (as Add Task places a
   task). Open questions that match the words are listed among the
   results with a `?` icon. Repeated misses are counted in workspace state
   and the row says *You have searched for this 3 times since 2 Oct*.
5. **Tag and person pages.** A **Questions** tab beside Notes and Tasks,
   listing questions under or mentioning the tag. Plan 36's card gains its
   **To ask Sam** group: open questions mentioning the person.
6. **Go to…** lists **Open questions** (the search page for
   `is:unanswered`).

## Assistant

`deckard_list_questions` (open by default) and the answer write through the
existing write path, so an assistant can answer one.

## Zen

The lens keeps count and age; widget and view buttons are quieted in place.

## Decisions taken (recommended options)

- **D4** `- [?]`.
- **D5** An `Answer:` child line marks it answered.
- **D6** Find offers to ask a missed search, written only when chosen.
- **Not on Home only:** the Questions view in the sidebar is the main way
  in; Home's widget and Go to… are extra.

## Tests

- Unit: parsing `[?]` and `Answer:` children; not a task (board, counts,
  `is:open`); `is:question/answered/unanswered`; answer offering (three
  uncommon words, tag rule, Not it); Find's Ask row text.
- Host (single file): the Questions view's rows and actions; the lens;
  Answer… writes the child line.
- Page behavior: the Home widget and the tag page's Questions tab.
