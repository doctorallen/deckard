# AI assistants

Deckard gives AI assistants in VS Code four tools through VS Code's language model tool API — two that read, so an assistant can answer questions about your notes from the index Deckard already keeps, and two that write, guarded the way Deckard's own writes are:

- **Search Deckard notes and tasks** (`deckard_query`, or `#deckardQuery` in a chat prompt) runs a [Deckard query](search.md#query-language) and returns the matching note sections and tasks, each with its workspace-relative path, line, and headings. Tasks also show whether they are done, their due and scheduled dates, priority, and repeat rule. Asking "what are my open tasks for Atlas?" leads the assistant to run `tag = #project/atlas AND task = open`.
- **List Deckard tags** (`deckard_list_tags`, or `#deckardTags`) lists tags with how many entries use each, most used first, optionally narrowed by a search, so the assistant queries the exact tag rather than a guess.

A query returns at most 25 notes and 25 tasks unless the assistant asks for more, up to 200, and always reports the full totals. A query that does not parse returns its error with a short guide to the syntax, so the assistant can correct it and try again.

Any assistant that uses VS Code's language model tools can call them; in GitHub Copilot's agent mode they appear in the tools picker. An assistant that connects to tools only through MCP servers, rather than through VS Code, cannot see them.

For these tools Deckard itself sends nothing anywhere: they read the local index, and what they return goes to the assistant that asked, which may send it to its own model service. So the first time an assistant calls one of the tools in a session, VS Code asks you to allow it, saying that your notes will go to the assistant; later calls in that session go ahead. Set `deckard.assistantTools` to `false` to hide both tools. Each call is timed in [Deckard's log](privacy-and-troubleshooting.md#limitations-and-troubleshooting).

**Writing, guarded.** `deckard_add_task` adds a task to today's note, or to a note the assistant names; `deckard_change_task` completes, reopens, retitles, dates, prioritizes, or hands over one existing task, named by its note and line as `deckard_query` reports them. An assistant asks before either runs, every time, and nothing is written until you approve the exact line in the same refactor preview Deckard's own multi-note writes use — whatever `deckard.previewWorkspaceWrites` says. A change is refused if the line is no longer the task the index knows there, so an assistant working from a stale answer cannot rewrite whatever is on that line now. `Deckard: Undo Last Change` takes a write back afterwards, as it does any write. So "add a task for Dana due Friday" is an assistant asking, you looking at one line, and saying yes.

### Suggest steps

**Break into Steps…** can ask a language model for a task's steps. When a VS Code language model is installed — GitHub Copilot's, or another extension's — the list offers **Suggest steps**, naming the model it would ask. Finding out whether a model is installed sends nothing: VS Code lists them locally. Choosing it sends one request to that model, holding the task's words and nothing else — no heading, no other line of the note, no other task — the first time behind VS Code's own consent dialog. The steps it suggests join the list marked *suggested*, to remove, reorder, change, or add to; nothing is written until you choose **Write**, and Escape or closing the list cancels the request. If the model refuses, fails, or takes more than 30 seconds, the list stays open with what you typed and says why; the details go to Deckard's log. Set `deckard.tasks.suggestSteps` to `false` never to offer it. This is the only place Deckard itself sends anything to a model.

### Claude Code and other MCP clients

Deckard can offer the same four tools to Claude Code and other Model Context Protocol clients. Over MCP there is no dialog before a write; the refactor preview is where you see the line and can decline it. Set `deckard.mcpServer.enabled` to `true`, or run `Deckard: Copy MCP Server Setup`, which offers to turn the server on and copies the command that adds Deckard to Claude Code:

```bash
claude mcp add --transport http deckard http://127.0.0.1:39217/mcp --header "Authorization: Bearer <token>"
```

- The server listens on `127.0.0.1` only, at `deckard.mcpServer.port`, so nothing off this computer can reach it.
- Every request must carry the server's token, which Deckard keeps in VS Code's secret storage. `Deckard: Reset MCP Server Token` makes a new one, and every copied setup stops working.
- Requests from web pages on other sites are refused, token or not, so a page open in a browser cannot read your notes through the server.
- As with the tools in VS Code, Deckard sends nothing anywhere itself: what a tool returns goes to the client that asked, which may send it to its own model service. The server is off by default.

---

← [Themes and Zen mode](themes-and-zen.md) · [All topics](README.md) · [Commands](commands.md) →
