#!/usr/bin/env node

import { program } from "commander";
import * as cmd from "../lib/commands.js";

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

async function run(fn) {
  try {
    const result = await fn();
    output(result);
    if (result?.error) process.exit(1);
  } catch (e) {
    output({ error: e.message, hint: errorHint(e) });
    process.exit(1);
  }
}

function errorHint(e) {
  if (e.message.includes("ECONNREFUSED") || e.message.includes("not running"))
    return "Start Zotero and ensure the CLI Bridge plugin is installed (Tools → Add-ons).";
  if (e.message.includes("timeout"))
    return "Zotero took too long to respond. The operation may still be running in Zotero — check manually.";
  return undefined;
}

program
  .name("zotero-bridge")
  .description(
    `Agent-friendly CLI for Zotero via JS Bridge.

All output is valid JSON. Every command returns either a result object
or {"error": "...", "hint": "..."} on failure.

Prerequisites:
  1. Zotero desktop must be running
  2. CLI Bridge plugin must be installed in Zotero
     (install with: zotero-cli app install-plugin, or manually from .xpi)

Environment:
  ZOTERO_PORT  Override the Zotero HTTP port (default: 23119)`
  )
  .version("0.1.0");

// ── Connection ──────────────────────────────────────────────────────

program
  .command("ping")
  .description("Check Zotero connection. Returns {ok: true} or {ok: false}.")
  .action(() => run(async () => ({ ok: await cmd.ping() })));

program
  .command("js <code>")
  .summary("Execute raw JavaScript in Zotero")
  .description(
    `Execute arbitrary JavaScript inside Zotero's privileged context.
The code runs as an async function body — use 'return' to output results.

Examples:
  zotero-bridge js "return Zotero.version"
  zotero-bridge js "return Zotero.Items.getAll(1).length"
  zotero-bridge js "var s = new Zotero.Search(); s.libraryID = 1; ..."

The code has full access to the Zotero JavaScript API:
  - Zotero.Items, Zotero.Collections, Zotero.Tags
  - Zotero.Search, Zotero.Translate, Zotero.Attachments
  - All async operations (use await)`
  )
  .action((code) => run(() => cmd.js(code)));

// ── Search ──────────────────────────────────────────────────────────

program
  .command("search <query>")
  .summary("Search items by title")
  .description(
    `Search the Zotero library by title. Returns an array of matching items.

Each result contains: key, title, date, creators.
Use the 'key' field to pass to other commands (item, tags, read, etc.).

Examples:
  zotero-bridge search "attention mechanism"
  zotero-bridge search "cellular automata" -n 5
  zotero-bridge search "NCA" -c "SEAD/道"`
  )
  .option("-n, --limit <n>", "max results (default: 10)", 10)
  .option("-c, --collection <name>", "scope search to a specific collection")
  .action((query, opts) =>
    run(() => cmd.search(query, { limit: +opts.limit, collection: opts.collection }))
  );

program
  .command("search-fulltext <query>")
  .summary("Search PDF full text content")
  .description(
    `Search inside PDF attachments' extracted text.
Slower than title search but finds content within papers.

Examples:
  zotero-bridge search-fulltext "chaos training"
  zotero-bridge search-fulltext "Koopman lifting" -n 20`
  )
  .option("-n, --limit <n>", "max results (default: 10)", 10)
  .action((query, opts) =>
    run(() => cmd.searchFulltext(query, { limit: +opts.limit }))
  );

// ── Item ────────────────────────────────────────────────────────────

program
  .command("item <key>")
  .summary("Get full item metadata")
  .description(
    `Get complete metadata for a Zotero item by its key.

Returns: key, title, date, type, creators, abstract, doi, url,
         tags, collections, attachments.

The <key> is an 8-character alphanumeric string (e.g. 5NTMA4E4).
Find keys via 'search' or 'collection-items'.

Examples:
  zotero-bridge item 5NTMA4E4
  zotero-bridge item ZGNZCEZB`
  )
  .action((key) => run(() => cmd.item(key)));

program
  .command("read <key>")
  .summary("Extract full text from PDF")
  .description(
    `Extract the full text from an item's PDF attachment.
Returns the complete text content for reading or analysis.

Returns: {key, chars, text} or {error: "no PDF attachment found"}.

Examples:
  zotero-bridge read 5NTMA4E4`
  )
  .action((key) => run(() => cmd.read(key)));

// ── Tags ────────────────────────────────────────────────────────────

program
  .command("tags <key>")
  .summary("List all tags on an item")
  .description(
    `List all tags attached to a Zotero item. Returns a string array.

Tag format follows the faceted vocabulary:
  /status     — workflow: /To Read, /In Progress, /Done
  #t/topic    — subject: #t/compositionality, #t/cellular-automata
  #m/method   — methodology: #m/ablation, #m/formal-proof
  #s/track    — research track: #s/道, #s/言吾
  #q/quality  — evaluation: #q/seminal, #q/useful

Run 'zotero-bridge vocab' to see the full controlled vocabulary.

Examples:
  zotero-bridge tags 5NTMA4E4`
  )
  .action((key) => run(() => cmd.tags(key)));

program
  .command("tag-add <key> <tags...>")
  .summary("Add tags to an item")
  .description(
    `Add one or more tags to a Zotero item. Returns updated tag list.
Tags should follow the faceted vocabulary (run 'vocab' to check).

Examples:
  zotero-bridge tag-add 5NTMA4E4 "#t/compositionality"
  zotero-bridge tag-add 5NTMA4E4 "#t/NCA" "#m/ablation" "#q/seminal"
  zotero-bridge tag-add 5NTMA4E4 "/Done"`
  )
  .action((key, tags) => run(() => cmd.tagAdd(key, tags)));

program
  .command("tag-rm <key> <tags...>")
  .summary("Remove tags from an item")
  .description(
    `Remove one or more tags from a Zotero item. Returns updated tag list.

Examples:
  zotero-bridge tag-rm 5NTMA4E4 "#t/compositionality"
  zotero-bridge tag-rm 5NTMA4E4 "/To Read"`
  )
  .action((key, tags) => run(() => cmd.tagRemove(key, tags)));

// ── Annotations ─────────────────────────────────────────────────────

program
  .command("annotations <key>")
  .summary("Read PDF annotations and highlights")
  .description(
    `Read all annotations from an item's PDF attachments.

Each annotation includes: type (highlight/note/underline),
text (highlighted content), comment, color, page.

Use this to read what the user or AI has annotated on a paper.

Examples:
  zotero-bridge annotations 5NTMA4E4`
  )
  .action((key) => run(() => cmd.annotations(key)));

// ── Import ──────────────────────────────────────────────────────────

program
  .command("import-doi <doi>")
  .summary("Import a paper by DOI")
  .description(
    `Import a paper into Zotero by its DOI.
Uses Zotero's built-in translators to fetch metadata.

Returns: {key, title, type} of the imported item.
After import, use 'find-pdf' to trigger PDF download,
and 'tag-add' to apply faceted tags.

Examples:
  zotero-bridge import-doi "10.23915/distill.00023"
  zotero-bridge import-doi "10.48550/arXiv.2009.01398" -c "SEAD/万法"
  zotero-bridge import-doi "10.1162/tacl_a_00000" -t "#t/CCG" "#s/言吾"`
  )
  .option("-c, --collection <name>", "add to collection (by name)")
  .option("-t, --tag <tags...>", "tags to apply after import")
  .action((doi, opts) =>
    run(() => cmd.importDoi(doi, { collection: opts.collection, tags: opts.tag }))
  );

// ── Collections ─────────────────────────────────────────────────────

program
  .command("collections")
  .summary("Show collection tree with item counts")
  .description(
    `Display the full Zotero collection hierarchy as a JSON tree.
Each node has: name, key, items (count), children.

Examples:
  zotero-bridge collections`
  )
  .action(() => run(() => cmd.collections()));

program
  .command("collection-items <key>")
  .summary("List items in a collection")
  .description(
    `List all items in a collection by its key.
Find collection keys via 'collections' command.

Examples:
  zotero-bridge collection-items 5FLS5JPP`
  )
  .action((key) => run(() => cmd.collectionItems(key)));

program
  .command("collection-create <name>")
  .summary("Create a new collection")
  .description(
    `Create a new collection. Optionally nest under a parent.

Examples:
  zotero-bridge collection-create "New Project"
  zotero-bridge collection-create "万法2" -p "SEAD/万法"
  zotero-bridge collection-create "SubFolder" -p 5FLS5JPP`
  )
  .option("-p, --parent <nameOrKey>", "parent collection (name or key)")
  .action((name, opts) =>
    run(() => cmd.collectionCreate(name, { parent: opts.parent }))
  );

// ── Highlight ───────────────────────────────────────────────────────

program
  .command("highlight <key> <text>")
  .summary("Create a text highlight annotation on a PDF")
  .description(
    `Find text in the PDF and create a highlight annotation with exact positioning.
The text is searched in the PDF using pdf.js — no manual coordinates needed.

Returns: {ok, key, page, text} on success.

Examples:
  zotero-bridge highlight 5NTMA4E4 "Growing Neural Cellular Automata"
  zotero-bridge highlight 5NTMA4E4 "self-organising" --comment "[Claude] key concept"
  zotero-bridge highlight 5NTMA4E4 "morphogenesis" --page 2 --color "#2ea8e5"`
  )
  .option("-c, --comment <text>", "annotation comment")
  .option("--color <hex>", "highlight color (default: #2ea8e5 blue)", "#2ea8e5")
  .option("-p, --page <n>", "search specific page only (1-indexed)")
  .action((key, text, opts) =>
    run(() =>
      cmd.highlight(key, text, {
        comment: opts.comment,
        color: opts.color,
        page: opts.page ? +opts.page : undefined,
      })
    )
  );

// ── PDF ─────────────────────────────────────────────────────────────

program
  .command("find-pdf <key>")
  .summary("Trigger Zotero's Find Available PDF")
  .description(
    `Ask Zotero to find and download a PDF for an item.
Returns {found: true, key, filename} or {found: false}.
This may take several seconds as Zotero searches online sources.

Examples:
  zotero-bridge find-pdf 5NTMA4E4`
  )
  .action((key) => run(() => cmd.findPdf(key)));

// ── Notes ───────────────────────────────────────────────────────────

program
  .command("note <key> <text>")
  .summary("Add a child note to an item")
  .description(
    `Add a child note to a Zotero item.
Use --prefix to identify the note author (e.g. [Claude], [Gemini]).

Notes appear in Zotero's info pane under the parent item.

Examples:
  zotero-bridge note 5NTMA4E4 "Key contribution: differentiable morphogenesis"
  zotero-bridge note 5NTMA4E4 "Core idea is chaos training" --prefix "[Claude]"`
  )
  .option("--prefix <prefix>", "author prefix, e.g. [Claude] or [Gemini]")
  .action((key, text, opts) =>
    run(() => cmd.noteAdd(key, text, { prefix: opts.prefix }))
  );

// ── Vocab ───────────────────────────────────────────────────────────

program
  .command("vocab")
  .summary("Show the tag controlled vocabulary")
  .description(
    `Display the faceted tag controlled vocabulary stored in Zotero.

The vocabulary is the single source of truth for all tag values.
Check it before adding new tags to avoid synonyms or duplicates.

Tag facets:
  /         status (workflow): /To Read, /In Progress, /Done
  #t/       topic (what the paper is about)
  #m/       method (how it was done)
  #s/       track (SEAD research direction)
  #q/       quality (evaluation judgment)

Examples:
  zotero-bridge vocab`
  )
  .action(() => run(() => cmd.vocab()));

// ── Sync ────────────────────────────────────────────────────────────

program
  .command("sync")
  .summary("Trigger Zotero cloud sync")
  .description(
    `Trigger a Zotero sync operation to push/pull changes with the cloud.
This may take several seconds.

Examples:
  zotero-bridge sync`
  )
  .action(() => run(() => cmd.sync()));

program.parse();
