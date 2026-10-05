# Contributing to Deckard

## Keeping Help accurate

Update `src/ui/webview/helpHtml.ts` in the same change whenever a user-facing
Deckard feature, command, setting, workflow, behavior, or limitation is added
or changed. Keep the **Quick start** section focused on the minimum usable
workflow, and place detailed configuration and specialized workflows in the
appropriate advanced category.

Documentation lives in three places, each with its own job:

- **Help** (`helpHtml.ts`) is the quick glance: what a reader most needs to
  know about each area, with **Read more** into the guide.
- **The guide** (`docs/guide/*.md`) is the full documentation, one topic to a
  page. Put the detail here: every option, edge case, and example. It ships in
  the VSIX, where Help's **Read more** shows it, is readable on GitHub, and is
  built into the site at <https://deckard.esperinnovations.com> by
  `.github/workflows/docs.yml`. Link pages
  to one another with relative `.md` links, and to screenshots as
  `../images/…`.
- **`README.md`** is the pitch: what Deckard is, the feature table, the
  themes, and a quick start. Add to it only when a feature belongs in that
  table; its detail goes in the guide.

Help and the guide must describe the same current behavior before a change is
merged. A new guide page also needs a line in `docs/guide/README.md`, and, if
Help has a section for it, the page named in that section's **Read more**.

## How the code is built

[How Deckard is built](architecture/README.md) explains the design for
contributors: the layers and the one rule for which may import which, the
index, the services, the webview pages, preferences, the test suites, and
the decisions behind them. It is published beside the guide at
<https://deckard.esperinnovations.com/architecture/>. Keep a page there
current in the same change as the code it describes, as Help and the guide
are kept current with what users see. `npm run lint` checks the import
rules, and each rule says why it exists in `.dependency-cruiser.cjs`.

## Comments and doc blocks

Comments are written for the next person to change the code, who can read
what it does but not why it is shaped that way.

- **Every exported function, class, method, and type gets a doc block**, and
  so does every private function that is not trivial. The block states the
  contract: what the function is for, what it returns when there is nothing,
  what it refuses, and why it exists when that is not obvious. Write
  `@param` and `@returns` only when the name and type do not already say
  it. A block that restates the signature is worse than none.
- **Inline comments say why, never what.** Write one for a constraint, a
  trade-off, a workaround, a bug it prevents, or a choice that looks wrong
  but is not: "The page may hold a snapshot from before a tag was renamed,
  so the key is resolved again." Delete a comment that narrates the next
  line. The task, daily-note, and capture commands in `src/ui/commands` are
  the ones to imitate.
- **A doc block sits directly above what it documents.** Nothing goes
  between a block and its declaration. A constant that must sit above a
  function gets its own one-line block, above the function's.
- **A comment moves with its code.** When a function is split or moved, its
  doc block and comments go with it, rewritten if the reason changed.

`npm run lint` enforces what a machine can see, with eslint-plugin-jsdoc:
exports, class methods, and exported types need a block; parameter names
must match; a block that documents some parameters documents them all; and
a block that only repeats its name fails. Code written before these rules
was listed in `eslint.known-violations.mjs` until it was brought up to
them; the list is empty now, and a new violation is fixed rather than
recorded there. Whether a comment explains why is for a reviewer to judge, so a
review asks it of every block and comment the change adds.

## Webview components

Each page is a bundle built from `src/webview/<page>/`: `main.tsx` and the
page's own components and modules, and `page.css` for its rules. What two or
more pages draw lives in `src/webview/shared/`, Preact components beside the
sheets they are drawn with, documented in [components.md](components.md).
The host only writes the page's shell (`src/ui/webview/<page>Html.ts`,
through `buildPageShell`) and sends its snapshot; what the page and its host
say to each other is typed once, in `src/ui/protocol/<page>.ts`.

To change a page:

- **Change what it draws** in its view, and what it does in its
  `listenForActions` table or its listeners. A page draws from one store:
  change the state with `store.update`, and never edit the DOM a draw made
  unless you put it back before the next draw.
- **Reuse a component** from `shared/` rather than drawing a look of your
  own, and move one there once a second page needs it. A component in
  `shared/` changes every page that draws it.
- **Keep the markup.** `npm run test:dom` compares every surface's DOM with
  its golden, and a change in what a reader sees is named in its commit and
  re-recorded there with `npm run test:dom -- --update`.

`npm run check-types` checks the page code against the DOM, and
`npm run lint` keeps a page from importing host code, another page, or any
package but Preact. Neither can see a sheet, so run `npm run test:ui` after
changing one, `npm run test:layout` when the change touches layout — a
scroll container, a column, a hover — since only that suite lays the pages
out, and `npm run test:visual` when it touches how anything looks, since only
that one sees a backdrop, a glow, or a control that moved. When the change in
looks is meant, record it with `npm run test:visual -- --update` and commit
the baselines it rewrites.

CI runs every suite on each pull request, split between jobs that run at
once ([Continuous integration](architecture/testing.md#continuous-integration)):
types, lint, and the import rules in one; the unit, host, page, and
end-to-end suites and the VSIX in another; each Chrome check in two shards
of the theme-and-zen passes; the DOM check; and the unit and host suites on
Windows and macOS. Its `validate` check passes only when every job did. The
Linux visual baselines come from CI, drawn in the Chrome version `ci.yml`
pins: a failed visual shard uploads each image that differs or had no
baseline, under its baseline's name, ready to commit once looked at. A
nightly run tests `dev` again with every suite one after another, and in
the oldest VS Code `engines` allows.

## Running the development host

The **Run Extension** launch configuration uses repository-local
`development-user-data` and `development-extensions` directories under
`.vscode/` and passes VS Code's `--disable-extensions` flag. This follows
VS Code's extension-debugging guidance and prevents installed extensions,
including another Deckard version, from registering overlapping commands or
link providers in the Extension Development Host. The integration test runner
uses the same `--disable-extensions` safeguard. The directories are ignored by
Git and can be removed when a clean development profile is needed.

## Writing Highlights

Each release's section in `CHANGELOG.md` opens with `### Highlights`: one to
three bullets, each one sentence of at most 140 characters, which may wrap
onto indented lines. Only `**bold**` and `` `code` `` are allowed inline, and
no links, since the same text is read on GitHub, in the Extensions view, and
in Help's **What's new**, which Home links to after a feature update. Write
them under `## Unreleased` before the release pull request merges. A feature
release (`x.y.0`) must have them: `scripts/changelog.js` refuses to cut one
without, and `src/test/changelog.test.ts` fails on one that has none, or more
than three.

## Release workflow

Open pull requests from `dev` into `main` or the current `master` branch.
When the pull request is ready to release, give it the `release` label, or
run the Prepare Release workflow by hand on `dev` (**Run workflow** in the
Actions tab). GitHub Actions then chooses the version increment from
Conventional Commit messages, cuts `## Unreleased` in `CHANGELOG.md` into that
version's dated section (`scripts/changelog.js cut`), and commits the
`package.json`, `package-lock.json`, and `CHANGELOG.md` update back to `dev`.
A push to the pull request cuts nothing, so it starts one CI run, not two.
Entries written under `## Unreleased` after the cut are folded into the same
section when the label is given again or the workflow is run again. With
nothing written, the section is made from the `feat:` and `fix:` commit
subjects; a feature release is refused until its Highlights are written.
Breaking changes (`feat!:`/`fix!:` or `BREAKING CHANGE:`) produce a major
release, `feat:` produces a minor release, and `fix:` produces a patch
release. Other commit types do not increment the version. If the pull request
already changes the version, the workflow preserves that explicit version.

After the pull request merges into either release branch, the Release workflow
tests the merged source, creates a `v<version>` tag and GitHub Release, and
uploads the generated VSIX, with the version's section of the changelog as
its notes. A version that already has a tag is not released again, but its
release's notes are brought into line with its section when the two differ.
Running the Release workflow by hand (**Run workflow** in the Actions tab)
does the same for every release the changelog has a section for.
