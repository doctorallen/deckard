# Screenshot Capture

Use `npm run capture:dashboard` to generate a temporary Dashboard candidate. Inspect it, then run `npm run capture:dashboard:promote` to update `docs/images/dashboard.png`.

- The script creates an isolated VS Code development host, temporary Markdown workspace, and temporary profile.
- It requires both CDP endpoints to respond, including `webSocketDebuggerUrl`, before capturing.
- It loads a temporary companion dev extension into the isolated host that closes the secondary (chat) side bar and runs `deckard.showDashboard` in-process, so no OS keystrokes touch any other window.
- It opens the Dashboard using the command ID `deckard.showDashboard` (contributed title `Deckard: Open Dashboard`). Never use `deckard.openDashboard`.
- It captures outside the repository first and only replaces the repository asset after explicit promotion, a Deckard dashboard-webview assertion, and a 1920x1080 PNG check.
- To capture another view, extend the script with its visible command title and an equivalent rendered-webview assertion. Do not use desktop screenshots or replace an existing asset before validating a temporary candidate.

The script needs the `code` command on `PATH` and a free CDP port. It uses CDP only to discover the workbench target and capture the screenshot. It chooses a free port by default; set `DECKARD_CDP_PORT` to override it. Set `DECKARD_SCREENSHOT_THEME` to `replicant`, `oblivion`, or `lcars`, and set `DECKARD_SCREENSHOT_OUTPUT` to choose a different output path. On failure, temporary host paths are printed and retained for diagnosis.
