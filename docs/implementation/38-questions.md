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

## As built

What was built where the plan was silent, or where the code made the plan
impractical:

- **The status.** `question` joins the status types (`TASK_STATUS_TYPES`,
  the manifest's enum), and `{ symbol: '?', name: 'Question', type:
  'question' }` ends Deckard's own list. `readTaskStatuses` adds it to a
  reader's list that does not name `?`, as it adds `X`. Edit Task Statuses
  shows Question's type as text, not a menu: no other status becomes a
  question and it becomes no other, and the workflow's Next menus leave it
  out. With `?` given to a status of the reader's own, questions are off,
  and the log says so once per window, when the first scan is done.
- **Where questions are kept.** Each note's questions are on
  `ParsedFile.questions` (the cache's parse format is now `note-questions`),
  and `getQuestions(index)` (`domain/index/questions.ts`) reads them once
  per index, rather than a map of its own on `WorkspaceIndex`, which every
  test that builds an index by hand would have had to fill. A question's id
  is `question-…`, made as a task's is. A question line starts no tagged
  entry, as a task line does not; its tags are read as a task's are.
- **The answer's day.** Answer…, Use as answer, and the assistant write
  `- Answer: <words> [[link]] (2026-10-14)`: the day as `YYYY-MM-DD`, which
  every reader of the note can read back, where the plan's example wrote
  `(14 Oct)`. *Answered 9 Oct* is read from the first day written on the
  answer's line; an answer with none says *answered*.
- **Offering an answer** is worked out when it is asked for, once per index,
  rather than when a note is saved: a line may answer a question when its
  note's day, a daily note's own or else when the note last changed, is on
  or after the day the question was asked. So nothing about offers is
  stored but Not it, and offers survive a restart. The lines are read by a
  line index (`domain/ranking/lineIndex.ts`), which plan 39 shares: built on
  first use, then brought up to each index by the notes that changed. A word
  is uncommon when it is no stop word, not one of a short list of words
  every note writes (*today*, *meeting*, *notes*…), and in at most 2% of
  lines (any such word below 50 lines). A typed row's field answers first,
  ahead of any line. Not it is kept as `<question id>␀<hash of the line's
  words>` in workspace state under `deckard.questions.notIt`, the last 500,
  apart from the preferences blob, as plan 38 asks.
- **The lens** has its own switch, `deckard.editor.questions`, as every
  group of lenses does (on in Full, Tasks, and Writing; off in Off). Its
  first lens opens the Questions view, the offer's opens the line, and under
  Zen it keeps those two and leaves out Answer… and Drop. Drop writes the
  cancelled status's character with its ❌ date, as cancelling a task does.
- **The Questions view.** VS Code cannot fold a view while it runs, so the
  view is listed open and, with nothing to list, says *No open questions.
  Write one as - [?] …*. The title bar's toggle is **Include Answered
  Questions** and **Leave Out Answered Questions**, since a command title may
  not start with *Show*. Answer… is a question row's inline button and its
  menu's first item, beside Drop. The offer row reads *May answer: Wed, Oct
  14 · Access*, the day in the reader's short date format.
- **Home's widget** opens the Questions view from its title, and its
  buttons are quiet under Zen until a question is pointed at.
- **Find.** Ask it writes under today's note's **Questions** heading when it
  has one, else after its last list, as Add Task's capture does. A miss is
  counted when Find closes on a search that found nothing with every word,
  not once per keystroke, and forgotten once the words are asked; the row
  counts this time too, *3 times since Fri, Oct 2*. Matching questions are
  the open ones whose words or tags hold every word typed.
- **The Questions tab** is a search page's, so any search that finds a
  question has it, a tag's or a person's page among them, and `is:unanswered`
  opens on it. Side by side, the questions are a list under the two panes. A
  row offers Answer…, not the offered line, which the view and Home show.
- **Go to…** lists Open questions after the pages, in its quick pick only:
  the pages are also Context's title-bar icons and DECKARD's menu, each with
  a glyph and drawn in the pages' DOM goldens, and Open questions is a
  search, not a page.
- **The assistant** has `deckard_answer_question` beside
  `deckard_list_questions`, a write through the refactor preview, as
  `deckard_change_task` is. Query blocks and the assistant's `deckard_query`
  list the questions a query finds, under their own heading.
- **Toggle Task Done** leaves a question's line alone.
- **Plan 36's To ask group** is not built here; `listQuestionsMentioning(index,
  person)` in `domain/index/questions.ts` lists the open questions that name
  a person on their own line, for it.
- **Tests and fixtures.** The tests that used `[?]` as a character no status
  names use `[b]`. The Task Board surface with a task of every status reads
  its note with Question left out of the statuses, so it still draws its
  Unknown `[?]` column as its DOM golden and baselines record it.
