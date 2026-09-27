# Piece 11 — Onboarding and what's new: implementation plan

Written 2026-09-25 against `dev` at `726d23b` (v1.22.0). Source plan:
`docs/ux-fifteen-sources-plan.md`, Piece 11 (11a–11g). Every claim below was
checked against the current source first.

---

## 1. Scope

Covered: **11a, 11b, 11c, 11d, 11e, 11f, 11g**, plus one bug turned up while
checking 11f (item **11f′**).

### What checking the source found

| Item | Claim in the plan | What the source says | Result |
| --- | --- | --- | --- |
| 11a | Nothing records the last version seen | True. No `lastSeenVersion`. The only `globalState` flag is `deckard.excludeHintShown` (`extension.ts:132`) | Kept |
| 11a | Highlights come from 1l | `CHANGELOG.md` still has everything since 1.14 under `## Unreleased`, and `release.yml` uses `--generate-notes` | Kept. Depends on 1l (see §7) |
| 11b | "three dated tasks were due 2026-09-12" | Slightly off. **One** task is due `2026-09-12` (`2026-08-02.md:11`) and one has `🛫 2026-09-21 📅 2026-10-01` (`:17`). All three daily notes are from August, and no task has a `#status/…` | Kept. The fix is the same |
| 11b | Install needs a folder dialog and a reload | True (`sampleWorkspace.ts:52`, `showOpenDialog`, then `vscode.openFolder`) | Kept |
| 11b | (new) | A user-level `deckard.notesFolder` (whose code default is `'notes'`, `dailyNote.ts:286`), `deckard.agenda.query`, or `deckard.board.statusNamespace` can make the opened sample look empty | Added: the sample ships a `.vscode/settings.json` |
| 11c | The walkthrough never mentions tasks | True. Its four steps are openNote, addTags, openHome, and search. All media are Markdown, with no images | Kept |
| 11c | (new) | `resources/walkthrough/home.md` says "the the Tasks view's list" | Fixed along the way |
| 11c | `deckard.hasTasks` | No such context key yet. Only `hasNotes` and `hasTags` are set (`extension.ts:239-240`) | Added |
| 11d | First activation finishes silently | True. The only thing said on `indexer.ready` is the ≥3,000-note exclude hint | Kept. Merged with that hint (see 1f) |
| 11e | Themes can only be chosen in Settings | True. The gear has Zen only (`components.ts:2055` `renderZenOption`) | Kept |
| 11f | Help names 29 commands as text | **27** distinct `<code>Deckard: …</code>` names. Two of them, `Deckard: Export` and `Deckard: Import` (`helpHtml.ts:521`), are not real titles. The real ones are "Export Favorites, Pins, and Searches" and "Import Favorites, Pins, and Searches" | Kept. The two names get fixed, and a test holds every name to the manifest |
| **11f′** | (new bug) | **The Help panel never runs its script.** `createWebviewPanel('deckard.help', …)` passes only `enableFindWidget` and `retainContextWhenHidden` (`help.ts:44-51`), with no `enableScripts`. So the scroll-spy that sets `aria-current` in the rail (`helpHtml.ts:525-551`) has never run in VS Code. It only runs in the jsdom and Chrome tests | Fixed first. 11f and 11a both need a message channel anyway |
| (related) | `renderHelpButton(anchor)` writes `data-help-anchor` | No host reads it. `openHelp` carries no anchor, and `HelpPanel.show()` takes none | 11a adds `HelpPanel.show(anchor?)`. The existing Help buttons can pass it later (Piece 8/9's call) |

Nothing is dropped.

**Where Highlights are read.** The brief asked for Highlights extracted "at build time (esbuild.js)". I chose a **runtime read of the shipped `CHANGELOG.md`** instead:

- The tests compile with `tsc` into `out/`, not with esbuild. A virtual module or an imported `.md` resolves in the bundle but not in `out/`, so it would break all four suites.
- A generated `.ts` file would have to exist before `check-types`, and would drift unless it was committed.
- `CHANGELOG.md` already ships in every VSIX. `.vscodeignore` does not exclude it, and it is what the Extensions view's Changelog tab shows.

Reading 84 KB once per activation and parsing it takes about a millisecond. A build-time guard still exists: a test in `npm test` fails when a feature release has no Highlights (§3, 11a).

---

## 2. Design

### 11f′ Help runs its script

`enableScripts: true` on create and on restore, as every other panel does. The
navigation rail then marks the section being read.

### 11f Commands in Help are buttons

- Every `<code>Deckard: X</code>` in Help's prose, and each name in the Commands table, becomes a `<button type="button" class="command-link" data-command="deckard.x">Deckard: X</button>`. On macOS, `Deckard: Find in Notes` is followed by `<kbd class="shortcut">Cmd+Shift+Alt+F</kbd>`; elsewhere it says `Ctrl+Shift+Alt+F`. The platform is read on the host.
- **Allowlist.** A command is runnable from Help only when all of these hold:
  1. It is in `contributes.commands` with category `Deckard`.
  2. Its `commandPalette` `when` is not `false`.
  3. That `when` names no editor context (`editorLangId`, `editorTextFocus`, `deckard.onTaskLine`). With Help focused, those commands would have no note to act on.

  Today that excludes Edit Task, Add Task, Rename Heading, Extract Tagged Heading, Move Inline Tags, Pin/Unpin Note, and Link Current Heading. Those stay `<code>` and keep their shortcut, with `title="Run it from a note"`.
- The page posts `{ type: 'runCommand', command }`. The host checks the id against the same allowlist before calling `executeCommand`, and ignores anything else. Nothing the page sends is trusted.
- Style: the look of the code chip, colored `--cyan`, with an underline on hover and focus and a focus ring. Inline targets are exempt from WCAG 2.2's 24px rule inside a sentence. The table cells use the chip at full control height.
- Help's text fixes: "`Deckard: Export`" becomes "`Deckard: Export Favorites, Pins, and Searches`", and the same for Import.

### 11a What's new

**How Highlights are written.** This is the contract with 1l. Under `## Unreleased`, the first subsection:

```markdown
## Unreleased

### Highlights

- Tasks more than a month overdue wait under **Needs a new date**.
- Search pages open rendered, with the words that matched marked.
- `Deckard: Choose Theme…` previews each theme as you move through them.

### Added
…
```

- One to three bullets, each a single sentence of at most 140 characters, which may wrap onto indented lines. Only `**bold**` and `` `code` `` are allowed inline. No links, because the same text is read on GitHub, in the Extensions view, and in Help.
- They are written by whoever prepares the release PR, before merge. 1l's cut renames `## Unreleased` to `## 1.23.0 - 2026-10-02`, and `### Highlights` stays inside it. The same section goes to `gh release create --notes-file`, so the GitHub release leads with it.
- Required for a minor or major version (`x.y.0`). Optional for a patch.
- Guard: `src/test/changelog.test.ts` reads the real `CHANGELOG.md`. It fails when the section for `package.json`'s version (from 1.23.0 on, for an `x.y.0` version) has no Highlights, or has more than three. CI runs `npm test` on the release PR after the bot's bump commit, so a feature release cannot be merged without Highlights.
- Backfill: 1l backfills 1.15–1.22 from tag dates. In this workstream, 1.18–1.22 get three Highlights each, written from their existing entries, so Help's section has content from the first release. This is content only; if 1l already wrote them, it is skipped.

**Version tracking** (`src/ui/commands/whatsNew.ts`, `class WhatsNew`):

- `globalState` keys:
  - `deckard.lastSeenVersion` (string)
  - `deckard.whatsNewPending` (`{ from: string; to: string }`)
- On activation, with `current = packageJSON.version`:
  - `seen = lastSeenVersion`. If it is undefined and either `globalState` or `workspaceState` already holds keys, this is an existing user on the first build that tracks versions, so `seen = '1.22.0'`. Undefined with no keys is a new install: record the version and say nothing, since new users get the walkthrough.
  - If `isFeatureUpdate(seen, current)` (major or minor went up) and the changelog has Highlights for some version in `(seen, current]`, then `whatsNewPending = { from: pending?.from ?? seen, to: current }`. Updates that are skipped keep the oldest `from`.
  - Always write `lastSeenVersion = current`.
- Pending is cleared by **What's new**, by **Dismiss**, or by opening Help's section through the command.
- A patch update says nothing. A downgrade says nothing.

**Home line.** It shares the `.home-hint-bar` slot, takes precedence over "Home is yours to arrange.", and shows one line at a time:

> `Updated to Deckard 1.23.` **[What's new]** **[Dismiss]**

- The version is written as major.minor.
- The Dismiss button's `title` is "Stop saying so", as the existing hint's is.
- Pending is global, so it disappears from every window's Home, not just this page's view state.

**Setting.**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `deckard.showWhatsNew` | boolean | `true` | `After an update that adds features, Home shows one line linking to what is new. Help's What's new section lists recent releases either way.` (General, order 3.) |

No toast, ever.

**Help's What's new section.**

- `<section id="whats-new">`, in the rail directly under Quick start.
- Heading: **What's new**.
- Intro: `The highlights of recent releases, newest first. The changelog has every change.`
- Then up to five releases that have Highlights, each an `<h3>1.23.0 · 2026-10-02</h3>` over its bullets. A release newer than `pending.from` carries a `New` chip (`.chip`, muted accent).
- Closes with a **Full changelog** button that posts `openChangelog`. The host runs `markdown.showPreview` on `extensionUri/CHANGELOG.md`.
- If the changelog cannot be read or has no Highlights: `This version's changes are listed in the changelog.` plus the same button.

**Command.** `deckard.openWhatsNew`, "What's New" (category Deckard). It opens Help scrolled to `#whats-new` and clears pending. It also lets David check the section on a release VSIX without waiting for an update.

### 11e Choose Theme

**Command.** `deckard.chooseTheme`, title "Choose Theme…" (category Deckard).

**The quick pick.**

- Title: `Deckard theme`.
- Placeholder: `Move through the themes to preview them. Enter keeps one, Escape puts back Corpo.` "Corpo" is replaced by the theme in use.
- Eight items. The label is a display name: Corpo, Replicant, Oblivion, LCARS, Synthwave, Tomcat, Fellowship, Cooper.
- The detail is the manifest's `enumDescriptions`, read from `packageJSON` so the text is never copied.
- The current theme has description `In use`, and is the active item on open.

**Preview.**

- `onDidChangeActive` calls `previewDeckardTheme(theme)`, debounced 120 ms.
- This is **in memory**. Nothing is written to `settings.json` while arrowing, so there is no Settings Sync churn and no file writes.
- `getDeckardTheme()` returns the preview first.
- A new `onDidChangePageChrome(listener)` in `components.ts` fires on `deckard.theme` / `deckard.zenMode` configuration changes **and** on preview changes. All eight hosts that use `affectsPageChrome` switch to it: Help, Stats, Dashboard, search pages, Graph, Calendar, Task board, and the sidebar.

**Accept and Escape.**

- **Accept** writes `deckard.theme` where the value in force comes from. `zenModeTarget` becomes a general `settingTarget(key)`: a folder's setting, else the workspace's, else the user's. The preview is then cleared without a redraw, since it already matches.
- **Escape** or hide without accepting clears the preview, and the pages redraw in the original theme. Nothing is written.

**Nowhere to preview.** If no Deckard webview tab is visible (`tabGroups`, `TabInputWebview.viewType` includes `deckard.`), the command first opens the Dashboard beside with `preserveFocus`. Otherwise, run from the walkthrough, it would preview on nothing.

**Gear row.** A **Theme** row directly above **Zen** on every page with a gear: Home/Dashboard, search pages, and the Task board.

- One button showing the current display name and an ellipsis, `Corpo…`.
- `aria-label`: `Theme: Corpo. Choose another`.
- It posts `chooseTheme`, handled once in `installViewOptions()` as zen is.
- Each of the three hosts maps it to `deckard.chooseTheme`.

### 11b Sample workspace

- **Tokens, resolved at install** against the local date:
  - In content, `{{date}}`, `{{date-9}}`, and `{{date+3}}` become `YYYY-MM-DD`.
  - A file named `day-9.md` is written as that date's daily note, `YYYY-MM-DD.md`.
  - The pure function `resolveSampleTokens(text, today)` and the name mapping `sampleFileName(name, today)` are both exported for tests.
- **Content changes** (`resources/sample/`):
  - `2026-08-01.md` → `day-9.md`, `2026-08-02.md` → `day-8.md`, `2026-08-05.md` → `day-5.md`. Headings become `# {{date-9}}` and so on. The gaps between them are kept, and so is the prose.
  - The `⏫ 📅 2026-09-12` task becomes `⏫ 📅 {{date-2}}` (the one **overdue**).
  - Pritchard's review becomes `🛫 {{date-4}} 📅 {{date+3}}` (the one **later this week**).
  - Argent's `opened: 2026-09-02` becomes `{{date-23}}`.
  - New `day-1.md` (**yesterday**): a short Wardens check-in with one done task and `- [ ] Review the shell-camera sequence with Ivo #status/doing` (moved from `day-9`, where it is replaced by a done line).
  - New `day-0.md` (**today**), with two tasks **due today**, `📅 {{date}}`:
    - `- [ ] Send the calibrated-lens error range to #person/sel-armitage #status/todo 📅 {{date}}`
    - `- [ ] Confirm the dawn team's relief roster with #person/nia-calder 🔼 📅 {{date}}`

    And one `#status/waiting` task, "Hear back from Praxis Loom on receiver audio retention".
  - That makes three tasks with a status: doing, todo, and waiting.
  - `#person/mara-vle` in `day-9` is kept on purpose. It is the lookalike that Stats (and 11g) offer to merge. The README says so.
  - `README.md` is rewritten:
    - "Nine notes" in place of seven.
    - The table names `{{date-9}}.md`… as resolved names.
    - A line on dates: `The dates are set on the day you create the sample, so one task is overdue, two are due today, and one is due later this week.`
    - The try-list gains `3. Deckard: Open Task Board — three tasks already have a status. Drag one to another column.`
    - The closing line: `This folder is kept in VS Code's storage for Deckard. Running Deckard: Create a Sample Workspace again replaces it with a fresh copy dated from that day.`
  - New `.vscode/settings.json` in the sample: `{ "deckard.notesFolder": "", "deckard.agenda.query": "", "deckard.board.statusNamespace": "status" }`. Your own settings then cannot hide the sample. The README names this in one line.
- **Where it goes.** `context.globalStorageUri/deckard-sample`. There is no folder dialog.
  - If the folder exists: modal warning `Replace the sample with a fresh copy? Anything changed in it is lost.` with **[Replace]** and **[Open As It Is]**.
  - Replace deletes it recursively (not to the trash), then writes the files.
- **Opening.**
  - In a window with no folder open, it opens there at once.
  - Otherwise: `Created a sample workspace of 9 notes. Open it in a new window, or in this one?` with **[Open in New Window]** **[Open Here]**.
- **README once, after the reload.**
  - Before opening, write `globalState['deckard.openSampleReadme'] = target.toString()`.
  - On activation, if a workspace folder's URI equals it: clear the key first, then run `markdown.showPreview` on its README.
  - The pure helper `takeSampleReadme(stored, folders)` returns the URI to open, or undefined.
- Strings that name "seven notes" or "a folder you choose" become "nine notes" and lose the folder: Home's empty state (`dashboardHtml.ts:916`), the walkthrough's first step, Help's Quick start, and README:85/118.

### 11c Walkthrough

Steps, in order. New and changed steps are marked.

1. `openNote`. Description changes: "seven notes" becomes "nine notes". Media stays Markdown.
2. `addTags`. Unchanged. Media stays Markdown.
3. **New `captureTask`.**
   - Title: **Capture a task**.
   - Description: `Write a task from anywhere without leaving what you are doing. Capture adds it to today's note and reads a date or a priority from its last words, such as "call Rhea friday".\n[Capture a task](command:deckard.capture)\n[Open the Tasks view](command:deckard.agenda.focus)`
   - Completion: `onCommand:deckard.capture`, `onContext:deckard.hasTasks`.
   - Media: image `resources/walkthrough/tasks-dark.png` / `tasks-light.png`. altText: `The Tasks view listing overdue, today's, and upcoming tasks beside a daily note.`
4. `openHome`.
   - Media becomes an image: `home-dark.png` / `home-light.png`. altText: `Home, with today's note, the Tasks view's list, and favorite tags as widgets.`
   - The Markdown text moves into the description: `Home collects today's note, your tasks, what is due, and the searches you keep. Customize in its gear adds, resizes, and reorders the widgets.`
5. `search`.
   - Media becomes an image: `search-dark.png` / `search-light.png`. altText: `A search page with its results and Refine beside them.`
   - The description gains the query examples from `search.md`: `Write words, #tags, is:open, or updated >= 7d, joined with AND, OR, and NOT.`
6. **New `makeItYours`.**
   - Title: **Make it yours**.
   - Description: `Deckard's pages come in eight looks. Choose Theme previews each as you move through them. Zen draws less frame around any of them.\n[Choose a theme](command:deckard.chooseTheme)\n[Enter zen mode](command:deckard.enableZenMode)`
   - Completion: `onCommand:deckard.chooseTheme`, `onSettingChanged:deckard.theme`, `onSettingChanged:deckard.zenMode`.
   - Media: a single image `themes.png`, a 2×2 of Corpo, Replicant, LCARS, and Cooper. altText: `The Dashboard in four of Deckard's eight themes: Corpo, Replicant, LCARS, and Cooper.`

**Images.**

- Screenshots use `light` / `dark` / `hc` (= dark) / `hcLight` (= light) keys.
- Captured with the existing `scripts/capture-dashboard-screenshot.mjs`, using Corpo with `DECKARD_SCREENSHOT_COLOR_THEME` set to "Default Dark Modern" and "Default Light Modern", and `DECKARD_SCREENSHOT_OUTPUT` pointed at `resources/walkthrough/`.
- A new npm script, `capture:walkthrough`, drives it.
- Budget: about 1000px wide and ≤150 KB each, ≤1 MB in total. That means downscaling in the capture script with pngjs (a devDependency already) and quantizing when `pngquant` is present.
- `themes.png` is composed from `docs/images/dashboard-{corpo,replicant,lcars,cooper}.png` by `scripts/build-theme-montage.mjs` (pngjs, box downscale).
- `docs/**` is not in the VSIX, and `resources/**` is, which is why the images live under `resources/walkthrough/`.
- `resources/walkthrough/home.md` and `search.md` are deleted once no step uses them. `home.md`'s "the the" typo goes with it.

**Context key.** `deckard.hasTasks` is set beside `hasNotes` and `hasTags` (`index.tasks.size > 0`).

**Command.** `deckard.openWalkthrough`, "Get Started" (category Deckard), which runs `workbench.action.openWalkthrough` with `` `${context.extension.id}#deckard.gettingStarted` ``.

**Links back.**

- Help's Quick start gets a first line: `New to Deckard? Deckard: Get Started opens the walkthrough: six steps, each checked off as you do it.` The name becomes a button through 11f.
- Home's gear gets a row **Get started** with a button `Walkthrough` (`data-action="open-view" data-view="walkthrough"`), which maps to `deckard.openWalkthrough` in `dashboard.ts:560`.

### 11d First-index summary

- **Once per workspace.**
  - At the top of `activate`, capture `const newToDeckard = context.workspaceState.keys().length === 0` before `PreferencesStore.initialize()` writes anything.
  - Show only when all of these hold:
    - `newToDeckard` is true.
    - A folder is open.
    - `workspaceState['deckard.firstIndexSummaryShown']` is unset.
    - The index has at least one note.
    - This is not the sample (the README takes that moment).
  - Write the flag **before** showing. An empty first index also sets it, so the message never arrives in the middle of work.
- **Text.** `describeFirstIndex({ notes, openTasks, overdue, tags })`, all numbers `en-US` localized:
  - Full: `Deckard read 412 notes: 1,204 open tasks (17 overdue) and 185 tags.`
  - No overdue: `Deckard read 412 notes: 1,204 open tasks and 185 tags.`
  - No open tasks: `Deckard read 412 notes and 185 tags.`
  - No tags: `Deckard read 412 notes: 1,204 open tasks (17 overdue).`
  - Neither: `Deckard read 412 notes.`
  - Singulars: `1 note`, `1 open task`, `1 tag`.
- **Overdue** is the Tasks view's Overdue group over all open tasks (`createAgenda`, no agenda query). That way it follows Piece 3's "Needs a new date" rule once that lands.
- **Buttons.** **[Open Dashboard]** **[Get Started]**.
  - For a large workspace (≥3,000 notes and `deckard.exclude` empty), one sentence is appended — ` If some folders hold Markdown you do not want read, deckard.exclude leaves them out.` — along with a third button, **[Leave Folders Out…]**, which opens that setting. The exclude hint's flag is then set as well, so the two never arrive back to back.
- Information severity.

### 11g Try next (later)

**Widget.**

- Home widget kind `tryNext`, label `Try next`, description `One suggestion, when your notes are ready for it`.
- Not repeatable, not listed.
- Added first in `DEFAULT_DASHBOARD_WIDGETS`, so it reaches new Homes. Homes already arranged find it in `+ Add widget…`.
- Outside Customize it draws **nothing** when there is no suggestion. It is never an empty box.

**One suggestion at a time**, the first that applies, from pure `chooseTryNext(input, retired, snoozed, now)`:

| id | When | Text | Action |
| --- | --- | --- | --- |
| `weeklyReview` | Today is the first day of the week (2e's `weekStart`, Sunday until then), at least 5 daily notes in the last 7 days, and no weekly note for last week | `You wrote 5 daily notes last week. A review lists what you finished and what is still open.` | **Write a Review** → `deckard.writeReview` |
| `mergeLookalike` | Stats' `findLookalikeTags` has a candidate | `#person/mara-vle looks like #person/mara-vale. Merging rewrites every note that uses it.` | **Merge…** → `deckard.mergeTag` with both keys |
| `taskBoard` | At least 10 open tasks and `deckard.showTaskBoard` never run in this workspace | `You have 42 open tasks. The Task board lays them out by status, and a drag rewrites the task.` | **Open Task Board** |
| `pinNote` | A note opened 5 or more times in 14 days (view counts in preferences) and nothing pinned | `You open Harbor.md often. Pin it to Home to keep it one click away.` | **Pin to Home** → `pinNote` for that note |

**Retiring and snoozing.**

- A suggestion is **retired** for good, in `workspaceState['deckard.tryNext.retired']`, once its command runs from anywhere. `mergeLookalike` is keyed per pair.
- Each card also has **[Not now]**, which snoozes that id for 7 days, and **[Don't suggest this]**, which retires it.

---

## 3. Implementation steps and tests

### Commit A: 11f′, Help runs its script

- `src/ui/webview/help.ts`: pass `enableScripts: true` in `createPanel`, and set `panel.webview.options = { enableScripts: true, enableFindWidget… }` in `attachPanel` so a restored panel runs it too.
- Tests (`npm test`): a new `src/test/help-page.test.ts`. It opens `getHelpHtml` in `openWebviewPage` and asserts the rail marks a section with `aria-current`. If `IntersectionObserver` is missing in jsdom, stub it and fire an entry. A host test uses a fake `createWebviewPanel` to assert `enableScripts` is set on both paths.

### Commit B: 11f, command buttons

- `helpHtml.ts`:
  - `HelpManifest` gains `menus?.commandPalette`.
  - New `runnableHelpCommands(manifest): Map<title, {command, binding?}>`, exported.
  - `linkCommandNames(html, runnable, platform)` post-processes the article: `<code>Deckard: (title)</code>` becomes a button plus `<kbd>`. A title not in the manifest is left as it is. The test catches that case.
  - `renderCommandTable` uses the same button for the name cell.
  - `getHelpHtml` gets a new `options: { platform?: NodeJS.Platform }` parameter, defaulting to `process.platform`.
  - CSS for `.command-link` and `kbd.shortcut`.
  - A click listener posts `runCommand`.
  - Fix the Export/Import names at `:521`.
- `help.ts`: `panel.webview.onDidReceiveMessage`. For `runCommand`, if `runnable.has(id)`, call `executeCommand(id)`.
- `src/ui/webview/messages.ts`: `parseHelpMessage` for `runCommand` (and, in commit C, `openChangelog`).
- `test/ui/pages.js`: pass `require('../../package.json').contributes` to `getHelpHtml` so the layout and contrast suites measure the buttons.
- Tests:
  - `npm test` (`help-page.test.ts`):
    - (1) Every `Deckard: …` name in Help is a manifest title. This fails today on Export/Import.
    - (2) A runnable command renders as `button.command-link[data-command]`. Clicking it posts `{type:'runCommand', command:'deckard.searchWorkspace'}`.
    - (3) `Deckard: Edit Task` renders as `<code>`, not a button.
    - (4) Find's shortcut shows `Cmd+Shift+Alt+F` for `darwin` and `Ctrl+Shift+Alt+F` for `linux`.
    - (5) The host ignores `runCommand` for `deckard.editTask` and for `workbench.action.quit`, using a fake `executeCommand` spy.
  - `npm run test:ui`: `verifyWebviews`/`checkWebviewScripts` parse the now-live script. `checkContrast` covers `.command-link` in all eight themes.
  - `npm run test:layout`: Help at 240px and at desktop width, with no overflow from `kbd` in table cells.

### Commit C: 11a, What's new

- New `src/core/changelog.ts` (pure, no vscode):
  - `parseChangelog(md): Release[]` (`{ version, date?, highlights: string[] }`, including an `Unreleased` pseudo-release).
  - `compareVersions`
  - `isFeatureUpdate(from, to)`
  - `releasesWithHighlights(releases, after?, upTo)`
  - `renderHighlightHtml(text)` (escape, then `**`→`<strong>` and `` ` ``→`<code>`).
- New `src/ui/commands/whatsNew.ts`, `class WhatsNew`:
  - `constructor(context)`
  - `releases(): Promise<Release[]>`, which reads `CHANGELOG.md` once, cached. Unreadable means `[]`, logged.
  - `async onActivate()`, the rules in §2.
  - `pending(): { version: string } | undefined`, which respects `deckard.showWhatsNew`.
  - `clear()`
  - `onDidChange` (an event, so Home redraws when another window clears it).
- `extension.ts`:
  - Construct it.
  - `void whatsNew.onActivate()`.
  - Pass it to `DashboardPanel` and `HelpPanel`.
  - Register `deckard.openWhatsNew` → `help.show('whats-new')` + `whatsNew.clear()`.
- `help.ts`:
  - `show(anchor?)` becomes async. It awaits `whatsNew.releases()` and builds the HTML with `{ releases, newSince }`.
  - For an existing panel it posts `{ type: 'reveal', anchor }`. For a new one it puts `data-anchor` on `<body>`, and the script scrolls to it after load.
  - Handles `openChangelog`.
- `helpHtml.ts`: a `renderWhatsNew(releases, newSince)` section, a rail link, and the reveal listener.
- `dashboard.ts`:
  - The state gains `whatsNew?: { version: string }` (`core/types.ts:434` beside `homeArranged`).
  - Messages `openWhatsNew` (runs the command) and `dismissWhatsNew` (`whatsNew.clear()`).
  - Refresh on `whatsNew.onDidChange` and on `deckard.showWhatsNew` config changes.
- `dashboardHtml.ts:904`: the hint slot renders the What's new line when `state.whatsNew` is present, otherwise the arrange hint as now.
- `package.json`:
  - The `deckard.showWhatsNew` setting.
  - The `deckard.openWhatsNew` command.
  - `COMMAND_NOTES['deckard.openWhatsNew'] = 'Opens the highlights of recent releases in Help.'`
- Content: Highlights for 1.18–1.22, unless 1l wrote them.
- Tests:
  - `npm test`, `changelog.test.ts`:
    - Parser on a fixture: wrapped bullets, missing Highlights, Unreleased, and the `## 1.14.0 - 2026-09-17` form.
    - `isFeatureUpdate` cases: 1.22.0→1.23.0 true, →1.22.1 false, →2.0.0 true, 1.23.0→1.22.0 false.
    - `renderHighlightHtml` escapes `<script>`.
    - **Real CHANGELOG guard:** for `package.json`'s version ≥ 1.23.0 with patch 0, its section has 1–3 Highlights of at most 140 characters each.
  - `npm test`, `whats-new.test.ts` (fake `Memento`s):
    - A new install records and stays silent.
    - An existing user with no `lastSeen` gets pending from 1.22.0.
    - A patch update is silent.
    - A minor update with Highlights sets pending.
    - Two skipped minors keep the oldest `from`.
    - A minor update without Highlights stays silent.
    - `clear()` empties pending.
    - `showWhatsNew: false` hides pending.
  - `npm test` (jsdom, `dashboard-behavior.test.ts`):
    - With `whatsNew: {version:'1.23'}` the bar says `Updated to Deckard 1.23.` and shows no arrange hint.
    - What's new posts `openWhatsNew`, and Dismiss posts `dismissWhatsNew`.
    - Without it, the arrange hint is back.
  - `npm test` (`help-page.test.ts`):
    - The section lists fixture releases newest first, with at most five.
    - `New` only on releases after `newSince`.
    - The empty fallback string.
    - Full changelog posts `openChangelog`.
    - The body's `data-anchor` scrolls to `#whats-new`.
  - `npm run test:e2e` (`dashboardHome.e2e.js`): a real host with a stub `WhatsNew`. Dismiss clears it and the next state has no line.
  - `npm run test:layout` / `test:ui`: `pages.js` renders Home with `whatsNew` set, so the hint bar wraps at 240px, and Help with fixture releases.

### Commit D: 11e, Choose Theme

- `themes.ts`:
  - `deckardThemeNames`
  - `previewDeckardTheme(theme | undefined, { silent? })`
  - `onDidChangeThemePreview`
  - `getDeckardTheme()` reads the preview first.
- `components.ts`:
  - `onDidChangePageChrome(listener): vscode.Disposable`.
  - `renderThemeOption()` in the page script, with the current theme's display name interpolated at HTML build time.
  - `installViewOptions()` handles `choose-theme` → `postMessage({type:'chooseTheme'})`.
- Switch the eight `affectsPageChrome` listeners to `onDidChangePageChrome`. The Dashboard keeps its combined listener and adds a preview subscription.
- `zenMode.ts`: generalize the target into `settingTarget(key, inspect)`, which `setZenMode` and the theme writer share. Move it to `commands/settings.ts`.
- New `src/ui/commands/chooseTheme.ts`:
  - `chooseTheme(manifest, deps = { createQuickPick, writeSetting, openDashboardBeside, hasVisibleDeckardPage })`.
  - Injected so it can be tested without a real quick pick.
  - Debounce 120 ms.
  - On accept, write. On hide without accept, restore.
- Add `renderThemeOption()` above `renderZenOption()` in `dashboardHtml.ts:992`, `searchPageHtml.ts:423`, and `taskBoardHtml.ts:218`. Parse `chooseTheme` in `messages.ts` (three parsers) and handle it in `dashboard.ts`, `searchPage.ts`, and `taskBoard.ts`.
- `package.json`: the `deckard.chooseTheme` command. `COMMAND_NOTES`: `Previews each theme on the open pages as you move through the list.`
- Tests:
  - `npm test`, `choose-theme.test.ts`:
    - Eight items, whose details equal `enumDescriptions`.
    - The current theme is `In use` and active.
    - Moving the active item sets `getDeckardTheme()` to it without writing.
    - Hide without accept restores it and writes nothing.
    - Accept writes once, to Workspace when the workspace sets it and to Global otherwise.
    - With no Deckard page visible, the Dashboard opens first.
    - `onDidChangePageChrome` fires on a preview.
  - `npm test` (jsdom, `zen-mode.test.ts` sibling): each of the three gears has a Theme row above Zen reading `Corpo…`, and clicking it posts `chooseTheme`.
  - `npm run test:e2e`: the task board and search page hosts run `deckard.chooseTheme` on `chooseTheme` (stub command registry).
  - `npm run test:layout`: gear menus are measured open where `checkLayout` already opens them. The Theme row must not overflow at 240px.
  - Visual baselines: the gear is closed in `test/ui/visual-baseline/darwin/*`, so **no re-record is expected**. Run `npm run test:visual` to confirm. If a surface differs only by the gear row, re-record that surface in a separate `test:` commit.

### Commit E: 11b, sample workspace

- `sampleWorkspace.ts`: rewritten.
  - `installSample(extensionUri, storageUri, today, fs, { replace })` walks the source recursively (including `.vscode/`). It reads each file, resolves tokens and names, and writes to the target.
  - It returns `{ target, notes }`, where `notes` counts the `.md` files other than the README.
  - `createSampleWorkspace(context)`: the replace prompt, the open prompt, and the README flag.
  - `takeSampleReadme`
- `extension.ts`: pass `context`. On activation, `takeSampleReadme` → `markdown.showPreview`.
- `resources/sample/*`: the renames, tokens, the two new notes, the README, and `.vscode/settings.json`.
- Strings in `dashboardHtml.ts:916`, `package.json` walkthrough step 1, `helpHtml.ts:307` Quick start, and `COMMAND_NOTES`.
- Tests (`npm test`, `sample-workspace.test.ts`, updated):
  - (1) Resolving at a fixed date, say 2026-10-07 (a Wednesday), gives 9 notes. After tokens are resolved, the README names every note file.
  - (2) Classified with `createAgenda` at that date: exactly 1 overdue, 2 due today, and 1 upcoming within 7 days.
  - (3) Exactly 3 open tasks carry `#status/…`, with 3 distinct values.
  - (4) Daily notes exist for yesterday and today, found by `listDailyNotes`.
  - (5) Install writes `.vscode/settings.json` with `deckard.notesFolder: ""`.
  - (6) Without `replace` an existing target rejects, and with it the target is replaced.
  - (7) No `{{` survives in any installed file.
  - (8) `takeSampleReadme` returns the README only for a matching folder, and the key is cleared.
  - `dashboard-behavior.test.ts`: the empty state says "nine notes".

### Commit F: 11c, walkthrough

- `package.json`: the six steps above, `featuredFor` unchanged, and the `deckard.openWalkthrough` command.
- `resources/walkthrough/`: the images and `themes.png`. `home.md` and `search.md` are removed.
- `scripts/capture-dashboard-screenshot.mjs`: an optional `DECKARD_SCREENSHOT_WIDTH` downscale. New `scripts/build-theme-montage.mjs`. New `npm run capture:walkthrough`.
- `extension.ts`: `deckard.hasTasks`, and register `deckard.openWalkthrough`.
- The Dashboard gear's "Get started" row and the `walkthrough` entry in the `openView` map (`dashboard.ts:560`). `messages.ts` accepts the new view name.
- Help's Quick start line.
- Tests:
  - `npm test`, `extension.test.ts`:
    - (1) Step ids in order.
    - (2) Every `command:` link in a step names a contributed command or a view-focus command of a contributed view (`deckard.agenda.focus`).
    - (3) Every `onContext:` key is one the source sets. The test greps for `setContext', '<key>'` in `out/extension.js`.
    - (4) Every media path exists. Each image is ≤150 KB and the total is ≤1 MB.
    - (5) Every image step has `altText`.
    - (6) `deckard.openWalkthrough` calls `workbench.action.openWalkthrough` with `${id}#deckard.gettingStarted`.
  - jsdom (`dashboard-behavior.test.ts`): the gear's Walkthrough button posts `openView` with `walkthrough`.
  - `npm run test:e2e`: the Dashboard host runs `deckard.openWalkthrough`.

### Commit G: 11d, first-index summary

- New `src/ui/commands/firstIndex.ts`:
  - `describeFirstIndex(counts)`
  - `countFirstIndex(index, now)` (open tasks, the overdue group from `createAgenda`, tags)
  - `shouldSummarize(...)`
  - `summarizeFirstIndex(context, indexer, flags)`
- `extension.ts`: capture `newToDeckard` before `preferences.initialize()`. In `indexer.ready`, run the summary first. If the summary covered the exclude hint, skip that hint. This coordinates with 1f's move of that flag into `workspaceState`.
- Tests (`npm test`, `first-index.test.ts`):
  - Every wording variant: all counts; zero overdue; zero tasks; zero tags; singulars; 1,204 with a comma.
  - Gating: not new, already shown, zero notes (sets the flag and shows nothing), and sample.
  - The large-workspace variant has three buttons and sets both flags.
  - Overdue counts only the Overdue group. A fixture task that is 2 days overdue counts. A task that is 40 days overdue counts until Piece 3 lands; after that it does not, and the test follows Piece 3's classification.

### Commit H: 11g, Try next (later)

- `core/types.ts`: `DashboardWidgetKind` gains `'tryNext'`, and the state carries `tryNext?: { id, text, action: { label, command, args? } }`.
- New `src/ui/state/tryNext.ts`: `chooseTryNext(input, retired, snoozed, now)` (pure). `input` is collected in `dashboard.ts` from the index, `listDailyNotes`, `findLookalikeTags` (exported from `dashboardState.ts`), and preferences' view counts and pins.
- `preferences.ts`: `DEFAULT_DASHBOARD_WIDGETS` gains `tryNext` first.
- `dashboardHtml.ts`: `WIDGET_KINDS.tryNext`. The widget renders one card or nothing, and posts `runTryNext`, `snoozeTryNext`, and `retireTryNext`.
- The `writeReview`, `mergeTag`, `showTaskBoard`, and `pinNote` handlers call `tryNext.retire(id)` on success. This goes through a small `TryNextLedger` over `workspaceState`, handed to them in `extension.ts`.
- Tests:
  - `npm test`, `try-next.test.ts`:
    - Each rule's positive and negative case.
    - First match wins.
    - Retired and snoozed ids are skipped.
    - A snooze expires after 7 days.
    - `mergeLookalike` is retired per pair.
    - The weekday follows `weekStart` once 2e lands.
  - `npm test`, `dashboard-widgets.test.ts`: renders nothing without a suggestion, and one card with its three buttons.
  - `npm run test:e2e`: `runTryNext` executes the allowed command. Only the four ids map to commands; the host looks the command up by id and does not take it from the page.
  - `npm run test:layout`: Home with a Try next card at 240px and at the three-column width.

**Every commit** runs all four suites and gates on exit codes: `npm test`, `npm run test:ui`, `npm run test:e2e`, `npm run test:layout`. It is verified in a short-path worktree and committed from its patch (per memory).

---

## 4. Tests: summary of new files

`src/test/help-page.test.ts`, `changelog.test.ts`, `whats-new.test.ts`,
`choose-theme.test.ts`, `first-index.test.ts`, `try-next.test.ts`.

Extended: `sample-workspace.test.ts`, `extension.test.ts`,
`dashboard-behavior.test.ts`, `dashboard-widgets.test.ts`,
`zen-mode.test.ts`, `test/e2e/dashboardHome.e2e.js`,
`test/e2e/taskBoard.e2e.js`, `test/e2e/searchPage.e2e.js`, and `test/ui/pages.js`.

Visual baselines: none expected to change. Dashboard and Help have no baselines, and the gears are captured closed. This is confirmed with `npm run test:visual` before commit D and commit H.

---

## 5. Docs

**README.**

- Themes (§55): a sentence: `Run Deckard: Choose Theme…, or Theme in any page's gear, to preview each theme on the open pages before keeping one.`
- Getting started (§85): the rewritten sample paragraph (nine notes, dated the day you create them, kept in VS Code's storage, README opens after the reload) and the new walkthrough steps.
- Commands table: **Choose Theme…**, **Get Started**, **What's New**, and the rewritten **Create a Sample Workspace** row.
- Settings table: `deckard.showWhatsNew`.
- A short **What's new** subsection under Home: the line, when it appears, and how to turn it off.

**Help** (`helpHtml.ts`).

- Quick start: the walkthrough line and the sample text.
- The new What's new section.
- The Zen card: `Choose Theme…` beside it.
- Command names become buttons.
- The Export/Import names are fixed.

**CHANGELOG `## Unreleased`**, one entry per commit:

- Fixed: `**Help marks the section being read.** The Help page never ran its script, so its navigation never followed the page.`
- Added: `**Commands in Help run from Help.** …`
- Added: `**What's new.** After a feature update, Home says so in one line …` This entry also documents the `### Highlights` convention in `docs/CONTRIBUTING.md`.
- Added: `**Choose Theme… previews each theme.** …`
- Changed: `**The sample workspace is dated the day it is made.** …`
- Added: `**The walkthrough covers tasks and themes.** …`
- Added: `**A first index says what it found.** …`
- Added: `**Try next.** …`

**docs/components.md.**

- The Controls table: `.command-link` and `kbd.shortcut`.
- The Page script helpers table: `renderThemeOption()` next to `renderZenOption()`, and `installViewOptions()` now also posting `chooseTheme`.
- Host-side helpers: `onDidChangePageChrome()` in place of `affectsPageChrome` for new pages.
- Home: the hint slot's order (What's new before the arrange hint) and the `tryNext` widget's "nothing when empty" rule.

**docs/CONTRIBUTING.md.** How to write Highlights: 1–3 one-sentence bullets, required for `x.y.0`.

---

## 6. Commits (in order; each ships on its own and passes all four suites)

1. `fix: Help marks the section being read, since its page now runs` (11f′)
2. `feat: a command named in Help runs from Help, with its shortcut beside it` (11f)
3. `feat: after a feature update, Home says so once and Help lists what is new` (11a, including the changelog guard and the 1.18–1.22 Highlights)
4. `feat: Choose Theme previews each theme on the open pages, and every gear offers it` (11e)
5. `feat: the sample workspace is dated the day it is made, opens without a folder dialog, and shows its README` (11b)
6. `feat: the walkthrough captures a task and makes Deckard yours, with screenshots, and Help and Home lead back to it` (11c)
7. `feat: a first index says how many notes, tasks, and tags it read` (11d)
8. `feat: Home suggests one thing to try next, once the notes are ready for it` (11g, later)

Order constraints: 2 before 3 (message channel, anchors). 4 before 6 (the walkthrough links Choose Theme). 5 before 6 (the step text says nine notes). 6 before 7 (the Get Started button).

---

## 7. Size, risks, dependencies, questions

**Size.** Commits 1–7 come to about 8 days:

| Item | Days |
| --- | --- |
| 11f′ | 0.25 |
| 11f | 1 |
| 11a | 2 |
| 11e | 1.5 |
| 11b | 1.5 |
| 11c | 1.25, including screenshots |
| 11d | 0.5 |

11g adds 2 days. **Total about 10 days.**

**Risks.**

- **Enabling Help's script.** Commit 1 turns on code that has never run in VS Code. It is covered by the jsdom and Chrome suites, but check once in a real window.
- **Preview redraws.** Each arrow press redraws every open Deckard page. At 5,000 notes a Dashboard redraw is slow (10c). The 120 ms debounce helps. If it is still heavy, preview only visible panels and redraw hidden ones on accept.
- **Replacing the sample.** Replacing it while it is the open workspace works, but open editors show deleted files. The prompt says so.
- **Walkthrough images** add up to 1 MB to the VSIX, and the test enforces that. Theme-aware images depend on VS Code's `light/dark/hc/hcLight` keys, which exist on the ^1.134 engine.
- **Existing-user detection** (`keys().length > 0`). A user who never let Deckard store anything would be treated as new and would miss the first What's new. That is harmless.
- **The changelog guard fails a release PR** until Highlights are written. This is intended; see the question below.

**Dependencies.**

- **Piece 1, 1l** (hard, for 11a). The cut `## X.Y.Z - date` sections and `--notes-file` releases. 11a's parser reads today's `## 1.14.0 - 2026-09-17` form, so it can land before 1l, but Home's line only fires once a feature release carries Highlights.
- **Piece 1, 1f** (11d). The exclude hint moves to `workspaceState`, and 11d folds it into the summary. Whichever lands second adapts to the other.
- **Piece 3**, Decision 1 (11d, sample). The overdue count follows the Tasks view's Overdue group. The sample's overdue task is 2 days late, well inside 30.
- **Piece 2, 2e** (11g). The weekly-review rule uses `weekStart`, Sunday until 2e lands.
- **Piece 8** (all new strings). Notification wording follows Piece 8's voice and severity rules. The strings here were written to them: say what happened, then the next step, no "successfully".
- **Piece 9** (optional). If Piece 9 makes a shared hint-bar primitive, the What's new line uses it. The existing Help buttons' `data-help-anchor` can call 11a's `HelpPanel.show(anchor)`.
- **Piece 12, 12d** (11g). Stats' lookalike list is the source for `mergeLookalike`.

**Open question for David.**

1. **Should a feature release fail CI until its Highlights are written?** My default: yes, for `x.y.0` versions only. The check runs on the release PR after the bot bumps the version, so you would add the three lines to the cut section before merging. The alternative is a warning in the PR. Then Home's line would silently not appear for a release without Highlights.
