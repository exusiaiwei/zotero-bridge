import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function findTextRects(pdfPath, searchText, { pageIndex } = {}) {
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;

  const results = [];
  const startPage = pageIndex != null ? pageIndex : 0;
  const endPage = pageIndex != null ? pageIndex + 1 : doc.numPages;

  for (let pi = startPage; pi < endPage; pi++) {
    const page = await doc.getPage(pi + 1);
    const textContent = await page.getTextContent();

    const items = textContent.items.filter((it) => it.str.length > 0);

    const segments = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i > 0) {
        const prev = items[i - 1];
        const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < 2;
        if (!sameLine) {
          const prevEnd = prev.str[prev.str.length - 1];
          if (prevEnd === "-") {
            segments[segments.length - 1].str = prev.str.slice(0, -1);
          } else {
            segments.push({ str: " ", item: null });
          }
        }
      }
      segments.push({ str: it.str, item: it });
    }

    const fullText = segments.map((s) => s.str).join("");
    const searchLower = searchText.toLowerCase();
    const matchIdx = fullText.toLowerCase().indexOf(searchLower);

    if (matchIdx === -1) continue;

    const matchEnd = matchIdx + searchText.length;
    let charIdx = 0;
    const rects = [];

    for (const seg of segments) {
      const segEnd = charIdx + seg.str.length;

      if (segEnd > matchIdx && charIdx < matchEnd && seg.item) {
        const tx = seg.item.transform;
        const itemX = tx[4];
        const itemY = tx[5];
        const itemW = seg.item.width;
        const itemH = seg.item.height;
        const itemLen = seg.str.length;

        const overlapStart = Math.max(matchIdx, charIdx);
        const overlapEnd = Math.min(matchEnd, segEnd);
        const startRatio = (overlapStart - charIdx) / itemLen;
        const endRatio = (overlapEnd - charIdx) / itemLen;

        const x1 = itemX + itemW * startRatio;
        const x2 = itemX + itemW * endRatio;

        rects.push([
          Math.round(x1 * 100) / 100,
          Math.round(itemY * 100) / 100,
          Math.round(x2 * 100) / 100,
          Math.round((itemY + itemH) * 100) / 100,
        ]);
      }
      charIdx = segEnd;
    }

    if (rects.length > 0) {
      results.push({
        pageIndex: pi,
        rects,
        matchedText: fullText.substring(matchIdx, matchEnd),
      });
      break;
    }
  }

  if (doc.destroy) await doc.destroy();
  else if (doc.cleanup) doc.cleanup();
  return results.length > 0 ? results[0] : null;
}
