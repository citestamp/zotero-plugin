// Node-runnable test for the Zotero core 1.7.2 (from engine 1.9.4, 2026-11-19).
//
//   node zotero-plugin/test/pool-core.test.mjs
//
// The core sends no CiteStamp address to Crossref any more (the public pool, paced by the queue),
// and every record lookup (Crossref, DataCite, doi.org) gets one retry after a non-answer, so a
// 429 no longer reads couldn't check. Mocked network; nothing leaves the box.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/check-core.js", import.meta.url), "utf8");
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body || {}) });
const later = (ms) => new Promise((done) => setTimeout(done, ms));
const urls = [];
const seen429 = new Set();
let inFlight = 0;
let maxInFlight = 0;

async function fetch(url) {
  const u = decodeURIComponent(url);
  urls.push(u);
  if (u.startsWith("https://api.crossref.org")) {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await later(30);
    inFlight--;
    if (u.includes("/works?") || u.includes("/journals")) { return res(200, { message: { items: [] } }); }
    const doi = u.split("/works/")[1].split("?")[0];
    if (!seen429.has(doi)) { seen429.add(doi); return res(429); }
    return res(200, { message: { DOI: doi, title: ["A paper about " + doi], issued: { "date-parts": [[2020]] }, type: "journal-article" } });
  }
  await later(5);
  if (u.includes("api.openalex.org")) { return res(429); }
  if (u.includes("api.datacite.org")) { return u.includes("/dois?") ? res(200, { data: [] }) : res(404); }
  return res(404);
}

const Core = new Function("fetch", src + "; return CiteStampCheckCore;")(fetch);
let failed = 0;
function check(name, cond) { console.log((cond ? "  ok  - " : "  FAIL- ") + name); if (!cond) { failed++; } }

(async () => {
  check("version 1.7.2", Core.version === "1.7.2");
  const dois = Array.from({ length: 6 }, (_, i) => "10.5555/zpool." + (3000 + i));
  const vs = await Promise.all(dois.map((d) => Core.checkOne({ doi: d, title: null }, { noGraph: true })));
  const cr = urls.filter((u) => u.startsWith("https://api.crossref.org"));
  check("Crossref was asked (" + cr.length + ")", cr.length >= 6);
  check("no Crossref lookup carries an email", cr.every((u) => u.indexOf("mailto") < 0));
  check("no lookup names info@citestamp.com", urls.every((u) => u.indexOf("info@citestamp.com") < 0));
  check("one Crossref request at a time (" + maxInFlight + ")", maxInFlight === 1);
  check("each DOI's 429 was asked again and it resolved (" + vs.filter((v) => v && v.resolved).length + "/6)", vs.every((v) => v && v.resolved));
  console.log(failed ? failed + " FAILED" : "all passed");
  process.exit(failed ? 1 : 0);
})();
