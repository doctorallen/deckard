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

## Webview components

Shared styling and page-script helpers live in `src/ui/webview/components.ts`,
documented in [components.md](components.md). Reuse a component rather than
restyling one locally, and add a new one there once a second page needs it.
Run `npm run test:ui` after changing it: the webviews are built from template
literals, so the compiler cannot see a broken style sheet or inline script.
Run `npm run test:layout` too when the change touches layout — a scroll
container, a column, a hover — since only that suite lays the pages out, and
`npm run test:visual` when it touches how anything looks, since only that one
sees a backdrop, a glow, or a control that moved. When the change in looks is
meant, record it with `npm run test:visual -- --update` and commit the
baselines it rewrites.

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
When a same-repository pull request is opened or reopened, GitHub Actions
chooses the version increment from Conventional Commit messages, then commits
the resulting `package.json` and `package-lock.json` update back to `dev`.
Breaking changes (`feat!:`/`fix!:` or `BREAKING CHANGE:`) produce a major
release, `feat:` produces a minor release, and `fix:` produces a patch
release. Other commit types do not increment the version. If the pull request
already changes the version, the workflow preserves that explicit version.

After the pull request merges into either release branch, the Release workflow
tests the merged source, creates a `v<version>` tag and GitHub Release, and
uploads the generated VSIX. A version that already has a tag is not released
again.
