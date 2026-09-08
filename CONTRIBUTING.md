# Contributing to Deckard

## Keeping Help accurate

Update `src/ui/webview/helpHtml.ts` in the same change whenever a user-facing
Deckard feature, command, setting, workflow, behavior, or limitation is added
or changed. Keep the **Quick start** section focused on the minimum usable
workflow, and place detailed configuration and specialized workflows in the
appropriate advanced category.

Also update `README.md` when the feature needs installation, configuration, or
reference documentation. Help and README must describe the same current
behavior before a change is merged.

## Running the development host

The **Run Extension** launch configuration uses repository-local
`development-user-data` and `development-extensions` directories under
`.vscode/` and passes VS Code's `--disable-extensions` flag. This follows
VS Code's extension-debugging guidance and prevents installed extensions,
including another Deckard version, from registering overlapping commands or
link providers in the Extension Development Host. The integration test runner
uses the same `--disable-extensions` safeguard. The directories are ignored by
Git and can be removed when a clean development profile is needed.

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
