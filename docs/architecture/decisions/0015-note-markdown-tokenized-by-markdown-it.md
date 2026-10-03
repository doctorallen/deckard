# 0015. Note Markdown is tokenized by markdown-it, not by our own parser

**Status:** Accepted (2026-10-01). Amends [0011](0011-host-bundle-ships-no-third-party-code.md).

## Context

[0011](0011-host-bundle-ships-no-third-party-code.md) replaced "`markdown-it` renders HTML, `sanitize-html` filters it, the page injects it" with a token tree that the page draws as elements and text nodes. It also dropped `markdown-it`, so Deckard had to read the Markdown itself. Step 1.9 of [the webviews plan](../../implementation/20-webviews.md) did that with a hand-written port of `markdown-it`'s rules: seven modules and 2,098 lines in `src/domain/markdown/`. To match what the pages showed, it ported emphasis pairing, link destinations, a 257-name entity table, and the block rules one for one.

The port matched every card and title in the comparison corpora. But it was Deckard's to maintain, and every `markdown-it` quirk it copied had to be copied again whenever `markdown-it` changed. A fuzz comparison found places where it did not match at all: code spans after an unclosed `[`, and whitespace at the end of an unclosed fence. Link reference definitions, HTML5 entity names, and non-ASCII hosts were left out on purpose (Q8 of the plan).

The tree is safe because of how the page draws it. A page draws a token as a text node or an element, and a link token holds only an `http`, `https`, or `mailto` URL. Which parser produced the tokens does not change that. `markdown-it` is also the engine VS Code's own Markdown preview uses.

## Decision

- `tokenizeInline` and `buildBlockExcerpt` keep their names, signatures, and token types. Each now maps the token stream of one `markdown-it` instance (`md.parseInline` and `md.parse`, never `md.render`) into `InlineToken` and `BlockToken`. The instance lives in `src/domain/markdown/markdownTokens.ts` and is configured as `rendering.ts` configures its own: `html: false`, `linkify: false`, `breaks: true`.
- Wiki links are not `markdown-it` syntax. One small inline rule reads them before links, as literal text with the note they name.
- The decisions recorded in Q8 still hold. A link to anything but `http`, `https`, or `mailto` becomes its words alone, judged from `markdown-it`'s normalized href. `~~` becomes a `del` token. Images draw nothing, and a table becomes its cells' words.
- Link reference definitions, entities, autolinks, hard breaks, and host encoding now follow `markdown-it`.
- The hand-written modules are deleted.
- `sanitize-html` still leaves in step 6, together with `rendering.ts`. `markdown-it` stays a dependency.

## Consequences

- `sanitize-html` is still the bulk of the host's third-party tree, and it still goes. With `postcss`, `htmlparser2`, and the rest of what it brings, it is 16 of the 23 package names the host bundle takes in, and about 200 kB of minified code. `htmlparser2` and `dom-serializer` also carry their own copies of `entities`.
- After step 6 the host ships no HTML sanitizer, and nothing in it renders note Markdown to HTML. It ships `markdown-it` and the five packages it brings (`entities`, `linkify-it`, `mdurl`, `punycode.js`, `uc.micro`), about 157 kB minified, plus `picomatch` per [0013](0013-exclude-globs-and-path-matchesglob.md). `scripts/check-bundle-inputs.js` then allows those seven packages in the host.
- `markdown-it` is now trusted to parse, though never to write HTML. A bug in it can mis-shape the tree, but it cannot inject markup, because the tree has no HTML token kind.
- The tree is what the pages show, `markdown-it`'s quirks included. Over the 2,796 card excerpts and titles of `scripts/compare-card-markdown.js` it is identical, token for token, to the port's. The only differences from the page's HTML are the 81 links to notes by relative path that Q8 decided.
- A note with link reference definitions, HTML5-only entity names, or non-ASCII link hosts now reads on a card as it does in the preview.

## Alternatives considered

- **Keep the hand-written port.** No third-party parser in the host, at the cost of 2,000 lines that copy `markdown-it` and must keep copying it.
- **Use `markdown-it`'s renderer and keep `sanitize-html`.** That keeps the filter 0011 replaced with a structural boundary, and the 17 packages that come with it.
- **Use another parser, such as `micromark` or `marked`.** Either would change how cards read, because the pages have always shown `markdown-it`'s reading. `micromark` also brings more packages.
