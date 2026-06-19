import * as bridge from "./bridge.js";

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const NOT_FOUND_HINT = "Use 'zotero-bridge search <query>' to find valid item keys.";
const COL_NOT_FOUND_HINT = "Use 'zotero-bridge collections' to list all collections.";
const NO_PDF_HINT = "Use 'zotero-bridge find-pdf <key>' to trigger PDF download.";

async function execWithItemCheck(key, jsBody) {
  const result = await bridge.execute(`
    var item = await Zotero.Items.getByLibraryAndKeyAsync(1, '${esc(key)}');
    if (!item) return null;
    ${jsBody}
  `);
  if (result === null) {
    return { error: `Item not found: ${key}`, hint: NOT_FOUND_HINT };
  }
  return result;
}

// ── Ping ────────────────────────────────────────────────────────────

export async function ping() {
  return bridge.ping();
}

// ── Raw JS ──────────────────────────────────────────────────────────

export async function js(code) {
  return bridge.execute(code);
}

// ── Search ──────────────────────────────────────────────────────────

export async function search(query, { limit = 10, collection } = {}) {
  const colFilter = collection
    ? `s.addCondition('collection', 'is', '${esc(collection)}');`
    : "";
  return bridge.execute(`
    var s = new Zotero.Search();
    s.libraryID = 1;
    s.addCondition('title', 'contains', '${esc(query)}');
    ${colFilter}
    var ids = await s.search();
    var items = await Zotero.Items.getAsync(ids);
    return items.filter(i => !i.isAttachment() && !i.isNote()).slice(0, ${limit}).map(i => ({
      key: i.key, title: i.getField('title'), date: i.getField('date'),
      creators: i.getCreators().slice(0,3).map(c => c.lastName).join(', ')
    }));
  `);
}

export async function searchFulltext(query, { limit = 10 } = {}) {
  return bridge.execute(`
    var s = new Zotero.Search();
    s.libraryID = 1;
    s.addCondition('fulltextContent', 'contains', '${esc(query)}');
    var ids = await s.search();
    var items = await Zotero.Items.getAsync(ids);
    return items.filter(i => !i.isAttachment() && !i.isNote()).slice(0, ${limit}).map(i => ({
      key: i.key, title: i.getField('title'), date: i.getField('date')
    }));
  `);
}

// ── Item ────────────────────────────────────────────────────────────

export async function item(key) {
  return execWithItemCheck(key, `
    var atts = item.getAttachments().map(id => {
      var a = Zotero.Items.get(id);
      return a ? {key: a.key, type: a.attachmentContentType, filename: a.attachmentFilename} : null;
    }).filter(Boolean);
    return {
      key: item.key, title: item.getField('title'), date: item.getField('date'),
      type: Zotero.ItemTypes.getName(item.itemTypeID),
      creators: item.getCreators().map(c => ({first: c.firstName, last: c.lastName})),
      abstract: (item.getField('abstractNote') || '').substring(0, 500),
      doi: item.getField('DOI') || '', url: item.getField('url') || '',
      tags: item.getTags().map(t => t.tag),
      collections: item.getCollections().map(id => {
        var c = Zotero.Collections.get(id); return c ? c.name : null;
      }).filter(Boolean),
      attachments: atts
    };
  `);
}

// ── Read fulltext ───────────────────────────────────────────────────

export async function read(key) {
  const result = await execWithItemCheck(key, `
    var attIDs = item.isAttachment() ? [item.id] : item.getAttachments();
    for (var aid of attIDs) {
      var att = Zotero.Items.get(aid);
      if (att && att.attachmentContentType === 'application/pdf') {
        var text = await att.attachmentText;
        return {key: att.key, chars: text ? text.length : 0, text: text || ''};
      }
    }
    return null;
  `);
  if (result && !result.error && result === null) {
    return { error: `No PDF attachment on item: ${key}`, hint: NO_PDF_HINT };
  }
  if (result && result.chars === undefined && !result.error) {
    return { error: `No PDF attachment on item: ${key}`, hint: NO_PDF_HINT };
  }
  return result;
}

// ── Tags ────────────────────────────────────────────────────────────

export async function tags(key) {
  return execWithItemCheck(key, `
    return item.getTags().map(t => t.tag);
  `);
}

export async function tagAdd(key, tagsToAdd) {
  const addLines = tagsToAdd.map((t) => `item.addTag('${esc(t)}');`).join("\n");
  return execWithItemCheck(key, `
    ${addLines}
    await item.saveTx();
    return {ok: true, tags: item.getTags().map(t => t.tag)};
  `);
}

export async function tagRemove(key, tagsToRemove) {
  const rmLines = tagsToRemove.map((t) => `item.removeTag('${esc(t)}');`).join("\n");
  return execWithItemCheck(key, `
    ${rmLines}
    await item.saveTx();
    return {ok: true, tags: item.getTags().map(t => t.tag)};
  `);
}

// ── Annotations ─────────────────────────────────────────────────────

export async function annotations(key) {
  return execWithItemCheck(key, `
    if (item.isAttachment && item.isAttachment()) {
      var p = Zotero.Items.get(item.parentItemID);
      if (p) item = p;
    }
    var attIDs = item.getAttachments();
    var all = [];
    for (var aid of attIDs) {
      var att = Zotero.Items.get(aid);
      if (att && att.isPDFAttachment && att.isPDFAttachment()) {
        try {
          var annots = att.getAnnotations();
          all = all.concat(annots.map(a => ({
            type: a.annotationType,
            text: (a.annotationText || '').substring(0, 300),
            comment: a.annotationComment || '',
            color: a.annotationColor || '',
            page: a.annotationPageLabel || ''
          })));
        } catch(e) {}
      }
    }
    return {count: all.length, annotations: all};
  `);
}

// ── Import ──────────────────────────────────────────────────────────

export async function importDoi(doi, { collection, tags: tagList } = {}) {
  const postImport = [];
  if (collection) {
    postImport.push(`
      var col = Zotero.Collections.getByLibrary(1).find(c => c.name === '${esc(collection)}');
      if (col) { item.addToCollection(col.id); }
    `);
  }
  if (tagList?.length) {
    for (const t of tagList) postImport.push(`item.addTag('${esc(t)}');`);
  }
  if (postImport.length) postImport.push("await item.saveTx();");

  const result = await bridge.execute(`
    var translate = new Zotero.Translate.Search();
    translate.setIdentifier({DOI: '${esc(doi)}'});
    var translators = await translate.getTranslators();
    translate.setTranslator(translators);
    var items = await translate.translate({libraryID: 1});
    if (!items || !items.length) return null;
    var item = items[0];
    ${postImport.join("\n")}
    return {key: item.key, title: item.getField('title'), type: Zotero.ItemTypes.getName(item.itemTypeID)};
  `, { timeout: 30000 });

  if (result === null) {
    return {
      error: `No results for DOI: ${doi}`,
      hint: "Check the DOI is correct. Format: 10.xxxx/xxxxx",
    };
  }
  return result;
}

// ── Collections ─────────────────────────────────────────────────────

export async function collections() {
  return bridge.execute(`
    function tree(cols, parentID) {
      return cols.filter(c => (c.parentID || 0) === (parentID || 0)).map(c => ({
        name: c.name, key: c.key,
        items: c.getChildItems().filter(i => !i.isAttachment() && !i.isNote()).length,
        children: tree(cols, c.id)
      }));
    }
    return tree(Zotero.Collections.getByLibrary(1), 0);
  `);
}

export async function collectionItems(key) {
  const result = await bridge.execute(`
    var col = await Zotero.Collections.getByLibraryAndKeyAsync(1, '${esc(key)}');
    if (!col) return null;
    var items = col.getChildItems().filter(i => !i.isAttachment() && !i.isNote());
    return items.map(i => ({
      key: i.key, title: i.getField('title'), date: i.getField('date'),
      creators: i.getCreators().slice(0,2).map(c => c.lastName).join(', ')
    }));
  `);
  if (result === null) {
    return { error: `Collection not found: ${key}`, hint: COL_NOT_FOUND_HINT };
  }
  return result;
}

export async function collectionCreate(name, { parent } = {}) {
  const parentJs = parent
    ? `var p = Zotero.Collections.getByLibrary(1).find(c => c.name === '${esc(parent)}' || c.key === '${esc(parent)}');
       if (p) col.parentID = p.id;
       else return null;`
    : "";
  const result = await bridge.execute(`
    var col = new Zotero.Collection();
    col.name = '${esc(name)}';
    col.libraryID = 1;
    ${parentJs}
    await col.saveTx();
    return {key: col.key, name: col.name};
  `);
  if (result === null) {
    return { error: `Parent collection not found: ${parent}`, hint: COL_NOT_FOUND_HINT };
  }
  return result;
}

// ── Find PDF ────────────────────────────────────────────────────────

export async function findPdf(key) {
  return execWithItemCheck(key, `
    var att = await Zotero.Attachments.addAvailablePDF(item);
    return att
      ? {found: true, key: att.key, filename: att.attachmentFilename}
      : {found: false, hint: 'Zotero could not find a PDF. Try manually or check the DOI.'};
  `, { timeout: 30000 });
}

// ── Vocab ───────────────────────────────────────────────────────────

const VOCAB_NOTE_KEY = "V7QLRQ7J";

export async function vocab() {
  const result = await bridge.execute(`
    var n = await Zotero.Items.getByLibraryAndKeyAsync(1, '${VOCAB_NOTE_KEY}');
    if (!n) return null;
    var html = n.getNote();
    var text = html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
    return {key: '${VOCAB_NOTE_KEY}', text: text};
  `);
  if (result === null) {
    return {
      error: "Tag vocabulary note not found in Zotero",
      hint: `Expected a standalone note with key '${VOCAB_NOTE_KEY}'. Was it deleted?`,
    };
  }
  return result;
}

// ── Notes ───────────────────────────────────────────────────────────

export async function noteAdd(key, text, { prefix } = {}) {
  const content = prefix ? `${prefix} ${text}` : text;
  return execWithItemCheck(key, `
    var note = new Zotero.Item('note');
    note.libraryID = 1;
    note.parentID = item.id;
    note.setNote('<p>${esc(content)}</p>');
    await note.saveTx();
    return {ok: true, noteKey: note.key};
  `);
}

// ── Sync ────────────────────────────────────────────────────────────

export async function sync() {
  return bridge.execute(
    "await Zotero.Sync.Runner.sync(); return {ok: true};",
    { timeout: 30000 }
  );
}
