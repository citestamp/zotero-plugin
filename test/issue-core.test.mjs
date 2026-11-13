// Node-runnable test for the cited-issue read in the Zotero core (1.6.0, from the served
// engine's 1.8.0). node zotero-plugin/test/issue-core.test.mjs
// An item with its journal, volume and pages (ref.loc from the plugin's locFromItem) whose
// title search finds nothing: the issue's records at Crossref decide. The cited title there
// is found; a different work on the cited page is confirm; a miss stays a no-match, never a
// not-found; Crossref is never sent the title for it. Mocked network.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/check-core.js", import.meta.url), "utf8");
const plugin = readFileSync(new URL("../content/citestamp.js", import.meta.url), "utf8");
const res = (status, body) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body || {}) });
const items = (xs) => res(200, { message: { items: xs } });
let M = {};
const urls = [];
function fetch(url) {
  urls.push(url);
  const u = decodeURIComponent(url);
  if (u.includes("api.crossref.org/journals")) return items(M.journals || []);
  if (u.includes("api.crossref.org/works?")) {
    if (u.includes("select=DOI,title,subtitle,container-title")) {
      if (u.includes("query.container-title=")) return items(M.issueSearch || []);
      if (u.includes("query.bibliographic=")) return items(M.issnSearch || []);
      return items(M.listing || []);
    }
    return items([]);
  }
  if (u.includes("api.crossref.org/works/")) return res(404, {});
  if (u.includes("api.datacite.org")) return res(404, {});
  if (u.includes("doi.org/ra/")) return res(200, [{ DOI: "x", status: "DOI does not exist" }]);
  if (u.includes("api.openalex.org")) return u.includes("/works/") ? res(404, {}) : res(200, { results: [] });
  if (u.includes("citestamp.com/api/v1/graph")) return res(404, {});
  return res(0, {});
}
const Core = new Function("fetch", src + "; return CiteStampCheckCore;")(fetch);
let failed = 0;
function check(name, cond) { console.log((cond ? "  ok  - " : "  FAIL- ") + name); if (!cond) { failed++; } }
const T = "Direct-to-consumer advertising of prescription drugs: implications for the patient-physician relationship";
const rec = (o) => ({ DOI: o.DOI, title: [o.title], "container-title": ["The Lancet"], volume: "366", issue: "9487", page: o.page, ISSN: ["0140-6736"], issued: { "date-parts": [[2005, 9]] }, "published-print": { "date-parts": [[2005, 9]] }, type: "journal-article" });
// the plugin's own locFromItem, on a stub item
const fields = { title: T, publicationTitle: "The Lancet", volume: "366", issue: "9487", pages: "789–791", date: "2005-09-03", DOI: "", extra: "" };
const item = { isRegularItem: () => true, getField: (n) => { if (!(n in fields)) { throw new Error("no field " + n); } return fields[n]; } };
const Zotero = { debug: () => {} };
const plug = new Function("Zotero", "CiteStampCheckCore", plugin + "; return CiteStamp;")(Zotero, Core);
async function run() {
  const ref = plug.refFromItem(item);
  check("locFromItem: journal, volume, issue, first page, year", JSON.stringify(ref.loc) === JSON.stringify({ journal: "The Lancet", volume: "366", issue: "9487", first_page: "789", year: 2005, titled: true }));
  const bare = { isRegularItem: () => true, getField: (n) => (n === "title" ? "A book chapter" : (n === "volume" || n === "pages" ? "" : "")) };
  check("locFromItem: no location without a volume and pages", !plug.refFromItem(bare).loc);
  M = { issueSearch: [rec({ DOI: "10.1016/real", title: T, page: "789-791" })] };
  let v = await Core.checkOne(plug.refFromItem(item), {});
  check("the title in the cited issue is found (" + v.status + ")", v.status === "ok" && v.resolvedVia === "crossref-issue" && v.work.doi === "10.1016/real");
  M = { issueSearch: [rec({ DOI: "10.1016/other", title: "A commentary on drug policy in Europe", page: "789-790" })] };
  v = await Core.checkOne(plug.refFromItem(item), {});
  check("a different work on the cited page is confirm, no work (" + v.status + ")", v.status === "needs-attention" && v.work === null && v.location.at_page.doi === "10.1016/other");
  M = { issueSearch: [rec({ DOI: "10.1016/a", title: "An unrelated letter about vaccines", page: "100-101" })] };
  urls.length = 0;
  v = await Core.checkOne(plug.refFromItem(item), {});
  check("a miss in the issue stays a no-match, never a not-found (" + v.status + ")", v.status === "no-match" && /Crossref returned 1 record for The Lancet 366\(9487\)/.test(v.notes.join(" ")));
  const issueUrls = urls.filter((u) => u.includes("container-title") || u.includes("/journals"));
  check("the year narrows the issue search", issueUrls.some((u) => decodeURIComponent(u).includes("from-pub-date:2004-01-01,until-pub-date:2006-12-31")));
  check("the title never goes to Crossref for the issue", issueUrls.every((u) => !decodeURIComponent(u).toLowerCase().includes("prescription")));
  // an item with no journal fields whose title reads like a location never triggers an issue read (review 2026-11-13)
  urls.length = 0;
  const odd = { isRegularItem: () => true, getField: (n) => (n === "title" ? "Nature, 1(1), 1." : "") };
  const oref = plug.refFromItem(odd);
  await Core.checkOne(oref, {});
  check("a title that reads like a location is not one", !oref.loc && urls.every((u) => !u.includes("container-title") && !u.includes("/journals")));
  check("version 1.6.0", Core.version === "1.6.0");
  console.log(failed ? "\n" + failed + " FAILED" : "\nALL OK");
  process.exit(failed ? 1 : 0);
}
run();
