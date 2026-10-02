# AI assistants

Deckard gives AI assistants in VS Code four tools through VS Code's language model tool API. Any assistant using those tools can call them; in GitHub Copilot's agent mode they appear in the tools picker. Assistants that connect only through MCP servers cannot see them; see [Claude Code and other MCP clients](#claude-code-and-other-mcp-clients).

- **Search Deckard notes and tasks** (`deckard_query`, or `#deckardQuery` in a chat prompt) runs a [Deckard query](search.md#query-language) and returns matching sections and tasks with path, line, and headings, plus each task's done state, due and scheduled dates, priority, and repeat rule. It returns at most 25 notes and 25 tasks unless asked for more, up to 200, and always reports full totals. A query that does not parse returns its error and a short syntax guide.
- **List Deckard tags** (`deckard_list_tags`, or `#deckardTags`) lists tags by use count, optionally narrowed by a search.
- `deckard_add_task` adds a task to today's note or a named note.
- `deckard_change_task` completes, reopens, retitles, dates, prioritizes, or hands over one task, named by note and line as `deckard_query` reports them.

**Reading.** The first time an assistant calls a tool in a session, VS Code asks you to allow it. Deckard sends nothing itself; the assistant may send what it gets to its model service. Set `deckard.assistantTools` to `false` to turn the tools off. Calls are timed in [Deckard's log](privacy-and-troubleshooting.md#limitations-and-troubleshooting).

**Writing.** The assistant asks before every write, and nothing is written until you approve the exact line in the refactor preview, whatever `deckard.previewWorkspaceWrites` says. A change is refused if the line is no longer the task the index knows. `Deckard: Undo Last Change` takes a write back.

### Suggest steps

In **Break into Steps…**, **Suggest steps** asks a VS Code language model (GitHub Copilot's or another extension's) for a task's steps. It appears only when a model is installed and names the model.

- It sends one request holding only the task's words, the first time behind VS Code's consent dialog.
- Suggested steps join the list marked *suggested*, to remove, reorder, change, or add to. Nothing is written until you choose **Write**. Escape or closing the list cancels.
- If the model refuses, fails, or takes over 30 seconds, the list stays open and says why; details go to Deckard's log.
- Set `deckard.tasks.suggestSteps` to `false` to hide it.

This is the only place Deckard itself sends anything to a model.

### Claude Code and other MCP clients

Deckard can offer the same four tools to Claude Code and other Model Context Protocol clients. Set `deckard.mcpServer.enabled` to `true`, or run `Deckard: Copy MCP Server Setup`, which offers to turn the server on and copies the command that adds Deckard to Claude Code:

```bash
claude mcp add --transport http deckard http://127.0.0.1:39217/mcp --header "Authorization: Bearer <token>"
```

- The server is off by default. It listens on `127.0.0.1` only, at `deckard.mcpServer.port`.
- With several VS Code windows open, the first window to start the server holds the port, and clients see that window's notes. The other windows wait quietly and take the port over when that window closes.
- Every request needs the server's token, kept in VS Code's secret storage and shared by every window. `Deckard: Reset MCP Server Token` makes a new one and breaks every copied setup.
- Requests from web pages on other sites are refused, token or not.
- There is no dialog before a write; the refactor preview is where you see the line and can decline it.
- Deckard sends nothing itself; the client may send what it gets to its model service.

---

← [Themes and Zen mode](themes-and-zen.md) · [All topics](README.md) · [Commands](commands.md) →
