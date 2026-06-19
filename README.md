# zotero-bridge

Agent-friendly CLI for Zotero via JS Bridge. Clean JSON, always.

A thin Node.js CLI that talks directly to Zotero's JS Bridge plugin endpoint. Designed for AI agents (Claude, GPT, Gemini, etc.) that need reliable, structured access to Zotero libraries.

## Why

Existing Zotero CLI tools produce inconsistent output (NDJSON, mixed formats), have poor error messages, and break in agent workflows. `zotero-bridge` fixes this:

- **Always valid JSON** — every command returns a JSON object or array
- **Structured errors** — `{"error": "...", "hint": "..."}` tells agents what went wrong and how to fix it
- **Detailed help** — every command has description, examples, and option docs
- **Minimal** — 3 files, ~400 lines, one dependency (`commander`)

## Prerequisites

1. **Zotero** desktop must be running
2. **CLI Bridge plugin** must be installed in Zotero — install the `.xpi` from [cli-anything-zotero](https://github.com/PiaoyangGuohai1/cli-anything-zotero) via `zotero-cli app install-plugin`, or manually

## Install

```bash
npm install -g zotero-bridge
```

## Commands

```
zotero-bridge ping                     Check Zotero connection
zotero-bridge search <query>           Search items by title
zotero-bridge search-fulltext <query>  Search PDF full text
zotero-bridge item <key>               Get full item metadata
zotero-bridge read <key>               Extract PDF full text
zotero-bridge tags <key>               List tags on an item
zotero-bridge tag-add <key> <tags...>  Add tags
zotero-bridge tag-rm <key> <tags...>   Remove tags
zotero-bridge annotations <key>        Read PDF annotations
zotero-bridge import-doi <doi>         Import paper by DOI
zotero-bridge collections              Show collection tree
zotero-bridge collection-items <key>   List items in collection
zotero-bridge collection-create <name> Create collection
zotero-bridge find-pdf <key>           Trigger PDF download
zotero-bridge note <key> <text>        Add child note
zotero-bridge vocab                    Show tag vocabulary
zotero-bridge sync                     Trigger Zotero sync
zotero-bridge js <code>                Execute raw JavaScript
```

Run `zotero-bridge help <command>` for detailed usage and examples.

## Architecture

```
zotero-bridge (Node.js CLI)
    ↓ HTTP POST text/plain → localhost:23119/cli-bridge/eval
CLI Bridge plugin (.xpi in Zotero)
    ↓ eval() in Zotero's privileged JS context
Zotero database
```

The CLI sends JavaScript code to Zotero's JS Bridge endpoint and parses the JSON response. All Zotero API operations happen inside Zotero itself — the CLI is a thin transport layer.

## License

MIT
