// Node-runnable test for the Zotero core's paced Crossref queue (1.7.1, from engine 1.9.3,
// 2026-11-19).
//
//   node zotero-plugin/test/pace-core.test.mjs
//
// The plugin checks every selected item at once (content/citestamp.js maps them all to checkOne
// together). Before 1.7.1 that sent every Crossref lookup at the same moment; now each one waits
// in one queue under Crossref's own limits: with an email, 3 at once, 10 records a second, list
// queries 400 ms apart. Mocked network that answers after a short delay; nothing leaves the box.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/check-core.js", import.meta.url), "utf8");
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body || {}) });
const later = (ms) => new Promise((done) => setTimeout(done, ms));

let inFlight = 0;
let maxInFlight = 0;
let starts = [];
const t0 = Date.now();

async function fetch(url) {
  const u = decodeURIComponent(url);
  if (u.startsWith("https://api.crossref.org")) {
    const isList = u.startsWith("https://api.crossref.org/works?");
    starts.push({ t: Date.now() - t0, list: isList });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await later(40);
    inFlight--;
    if (isList || u.includes("/journals")) { return res(200, { message: { items: [] } }); }
    const doi = u.split("/works/")[1].split("?")[0];
    return res(200, { message: { DOI: doi, title: ["A paper about " + doi], issued: { "date-parts": [[2020]] }, type: "journal-article" } });
  }
  await later(10);
  if (u.includes("api.openalex.org")) { return res(429); }
  if (u.includes("api.datacite.org")) { return u.includes("/dois?") ? res(200, { data: [] }) : res(404); }
  return res(404);
}

const Core = new Function("fetch", src + "; return CiteStampCheckCore;")(fetch);
let failed = 0;
function check(name, cond) { console.log((cond ? "  ok  - " : "  FAIL- ") + name); if (!cond) { failed++; } }
function peak(ts) {
  const s = ts.slice().sort((a, b) => a - b);
  let m = 0;
  for (let i = 0, j = 0; i < s.length; i++) { while (s[i] - s[j] >= 1000) { j++; } m = Math.max(m, i - j + 1); }
  return m;
}

(async () => {
  check("version 1.7.2", Core.version === "1.7.2");

  // 20 items with DOIs, all checked at once, OpenAlex out
  const dois = Array.from({ length: 20 }, (_, i) => "10.5555/pace." + (1000 + i));
  await Promise.all(dois.map((d) => Core.checkOne({ doi: d, title: null }, { noGraph: true })));
  check("DOIs: at most 3 Crossref requests in flight (" + maxInFlight + ")", maxInFlight <= 3);
  check("DOIs: at most 10 records started in any second (" + peak(starts.map((s) => s.t)) + ")", peak(starts.map((s) => s.t)) <= 10);

  // 8 items by title only, all at once: the fallback searches go one at a time, 400 ms apart
  inFlight = 0; maxInFlight = 0; starts = [];
  const titles = Array.from({ length: 8 }, (_, i) => "A study of the effects of condition number " + (i + 1) + " on long term outcomes in adults");
  await Promise.all(titles.map((t) => Core.checkOne({ doi: null, title: t }, { noGraph: true })));
  const lists = starts.filter((s) => s.list).map((s) => s.t).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < lists.length; i++) { minGap = Math.min(minGap, lists[i] - lists[i - 1]); }
  check("titles: " + lists.length + " searches, at least 8", lists.length >= 8);
  check("titles: searches at least 380 ms apart (" + minGap + ")", minGap >= 380);
  check("titles: at most 3 Crossref requests in flight (" + maxInFlight + ")", maxInFlight <= 3);

  console.log(failed ? failed + " FAILED" : "all passed");
  process.exit(failed ? 1 : 0);
})();
