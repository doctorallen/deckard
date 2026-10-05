# For your security reviewer

What Deckard reads, stores, and sends, in one place, for anyone who has to approve it.

## Network

- **Deckard makes no network requests of its own.** There is no account, no sign-in, no telemetry, and no update check of its own; the code has no HTTP client.
- **Two features hand note text to something else, and only when you use them:**
  - [Suggest steps](ai-assistants.md#suggest-steps) sends one task's words to a VS Code language model, such as GitHub Copilot's, the first time behind VS Code's consent dialog. `deckard.tasks.suggestSteps` set to `false` hides it.
  - The [AI assistant tools](ai-assistants.md) answer searches from an assistant you run in VS Code; the assistant may send what it gets to its own model service. `deckard.assistantTools` set to `false` turns them off.
- **The MCP server** is off by default (`deckard.mcpServer.enabled`). Turned on, it listens on `127.0.0.1` only, at `deckard.mcpServer.port` (39217), every request needs a token kept in VS Code's secret storage, and requests from web pages on other sites are refused. `Deckard: Reset MCP Server Token` breaks every copied setup.
- **Esper Themes**, suggested once, is installed by VS Code from the Marketplace, and only if you select **Install**.

## Where it runs

- Deckard runs where the workspace is: on the remote machine over Remote-SSH, in the container in a dev container or Codespace, as any workspace extension does. Its MCP server then listens on that machine's `127.0.0.1`, so a client on your own computer reaches it only through a port you forward.
- In a workspace VS Code does not trust (Restricted Mode), VS Code keeps Deckard off.
- `Deckard: Pause in This Workspace` stops it reading and writing a workspace until you resume it.

## What it stores

| What | Where | How to remove it |
| --- | --- | --- |
| A search cache, `deckard-search.sqlite`: note words and each note as last read | VS Code's storage for the workspace, outside your folder; see [Local cache](privacy-and-troubleshooting.md#source-safety-and-persistence) | Delete it; Deckard reads the notes again on its next start |
| Favorites, pins, saved searches, Home's widgets, view counts, and whether Deckard is paused here | VS Code's workspace and global state | `Deckard: Export Favorites, Pins, and Searches` shows what is kept; VS Code keeps it with its own state |
| The MCP server's token | VS Code's secret storage | `Deckard: Reset MCP Server Token` |
| Your notes | Your files, as plain Markdown | Deckard writes them only as [What Deckard writes](what-deckard-writes.md) lists |

Nothing Deckard stores is written into your workspace folder, except the notes and files that page lists.

## Updates and what ships

- Deckard is published on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=esperinnovations.deckard-notes) as `esperinnovations.deckard-notes`, and updates as VS Code's `extensions.autoUpdate` says. Each release's changes are in the [changelog](../../CHANGELOG.md), and each [GitHub release](https://github.com/doctorallen/deckard/releases) carries the same VSIX.
- The extension bundles three open-source packages: `markdown-it` (with its own small dependencies) and `picomatch` in the extension, and `preact` in its pages. Its search cache uses Node's built-in SQLite. A build check fails if anything else is bundled.
- Its pages run under a content security policy with a fresh nonce for each script, and draw a note's Markdown without running anything in it.

---

← [Privacy, source safety, and troubleshooting](privacy-and-troubleshooting.md) · [All topics](README.md) · [What Deckard writes](what-deckard-writes.md) →
