// Node-runnable test for the record-against-the-item reads in the Zotero core (1.7.0, from
// the served engine's 1.9.0). node zotero-plugin/test/record-core.test.mjs
// A DOI's record is read against the item's title (a word swapped), year (more than a year
// from every year the record carries; for a book, only a later one) and creators (none of
// the record's authors); a title found by search against the item's creators, and a book
// item is never settled on a journal item that shares its title. Each is needs-attention,
// never a negative; a spelling variant, a one-year gap and a partial author list stay ok.
// Items go through the plugin's own refFromItem. Mocked network.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/check-core.js", import.meta.url), "utf8");
const plugin = readFileSync(new URL("../content/citestamp.js", import.meta.url), "utf8");
const res = (status, body) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(JSON.parse(JSON.stringify(body || {}))) });
const yearOf = (m) => (m && m.issued && m.issued["date-parts"] && m.issued["date-parts"][0] ? m.issued["date-parts"][0][0] : null);
const oa = (m) => ({ id: "https://openalex.org/W" + String(m.DOI).length, doi: "https://doi.org/" + String(m.DOI).toLowerCase(), title: m.title[0], display_name: m.title[0], publication_year: yearOf(m), is_retracted: false });
let N = {};
function fetch(url) {
  const u = decodeURIComponent(url);
  const cr = new Map((N.cr || []).map((m) => [String(m.DOI).toLowerCase(), m]));
  if (u.includes("api.openalex.org/works/https://doi.org/")) {
    const d = u.split("api.openalex.org/works/https://doi.org/")[1].split("?")[0].toLowerCase();
    return cr.has(d) ? res(200, oa(cr.get(d))) : res(404, {});
  }
  if (u.includes("api.openalex.org/works?")) return res(200, { results: (N.search || []).map(oa) });
  if (u.includes("api.crossref.org/journals")) return res(200, { message: { items: [] } });
  if (u.includes("api.crossref.org/works?")) return res(200, { message: { items: [] } });
  if (u.includes("api.crossref.org/works/")) {
    const d = u.split("api.crossref.org/works/")[1].split("?")[0].toLowerCase();
    return cr.has(d) ? res(200, { message: cr.get(d) }) : res(404, {});
  }
  if (u.includes("api.datacite.org")) return res(404, {});
  if (u.includes("doi.org/ra/")) return res(200, [{ DOI: "x", status: "DOI does not exist" }]);
  if (u.includes("citestamp.com/api/v1/graph")) return res(404, {});
  return res(0, {});
}
const Core = new Function("fetch", src + "; return CiteStampCheckCore;")(fetch);
const Zotero = { debug: () => {} };
const plug = new Function("Zotero", "CiteStampCheckCore", plugin + "; return CiteStamp;")(Zotero, Core);
let failed = 0;
function check(name, cond) { console.log((cond ? "  ok  - " : "  FAIL- ") + name); if (!cond) { failed++; } }

const rec = (r) => Object.assign({
  DOI: r.DOI, title: [r.title], "container-title": r.journal ? [r.journal] : [],
  issued: { "date-parts": [[r.year, 6]] }, type: r.type || "journal-article",
}, r.authors ? { author: r.authors.map((family) => ({ family, given: "A." })) } : {}, r.extra || {});
// a stub Zotero item: fields, creators (last names) and an item type
function item(o) {
  const fields = Object.assign({ title: "", DOI: "", extra: "", date: "", publicationTitle: "", volume: "", pages: "", issue: "" }, o.fields);
  return {
    isRegularItem: () => true,
    getField: (n) => { if (!(n in fields)) { throw new Error("no field " + n); } return fields[n]; },
    getCreators: () => (o.creators || []).map((lastName) => ({ firstName: "A.", lastName, creatorTypeID: 1 })),
    itemType: o.type || "journalArticle",
  };
}
async function run(it, net) {
  N = net;
  const v = await Core.checkOne(plug.refFromItem(it), { noGraph: true });
  return { v, notes: v.notes.join(" | ") };
}

const CVPR_T = "Structural Multiplane Image: Bridging Neural View Synthesis and 3D Reconstruction";
const CVPR = rec({ DOI: "10.1109/cvpr52729.2023.01603", title: CVPR_T, year: 2023, authors: ["Writer", "Author", "Scholar", "Reader", "Editor", "Critic"] });
const cvprItem = (o = {}) => item({ fields: { title: o.title || CVPR_T, DOI: "10.1109/CVPR52729.2023.01603", date: o.date || "2023-06-18" }, creators: o.creators || ["Writer", "Critic"] });
const BANNED = /\bfake\b|fabricat|made up|does not exist|doesn't exist|\bverified\b/i;

async function main() {
  check("version: core 1.7.0", Core.version === "1.7.0");

  const ref = plug.refFromItem(cvprItem());
  check("refFromItem carries creators, year and type, never ref.year", JSON.stringify(ref.authors) === '["Writer","Critic"]' && ref.citedYear === 2023 && ref.itemType === "journalArticle" && ref.year === undefined);

  let r = await run(cvprItem(), { cr: [CVPR] });
  check("matching item: ok (" + r.v.status + ")", r.v.status === "ok");
  r = await run(cvprItem({ date: "2031" }), { cr: [CVPR] });
  check("a year far from the record's: needs-attention naming both (" + r.v.status + ")", r.v.status === "needs-attention" && r.notes.includes("the record gives the year 2023 and the citation 2031") && !BANNED.test(r.notes));
  r = await run(cvprItem({ date: "2024" }), { cr: [CVPR] });
  check("a year apart: ok (" + r.v.status + ")", r.v.status === "ok");
  r = await run(cvprItem({ title: "Structural Multiplane Visual: Bridging Neural View Synthesis and 3D Reconstruction" }), { cr: [CVPR] });
  check("a word swapped: needs-attention, not a title mismatch (" + r.v.status + ")", r.v.status === "needs-attention" && r.v.titleMismatch === false && r.notes.includes("the cited title differs slightly from it"));
  r = await run(cvprItem({ creators: ["Stranger", "Outsider"] }), { cr: [CVPR] });
  check("none of the record's authors: needs-attention naming them (" + r.v.status + ")", r.v.status === "needs-attention" && r.notes.includes("none of the cited authors is among the record's (Writer, Author, Scholar and others)"));
  r = await run(item({ fields: { title: CVPR_T, DOI: "10.1109/CVPR52729.2023.01603", date: "2023" } }), { cr: [CVPR] });
  check("an item with no creators raises no author doubt (" + r.v.status + ")", r.v.status === "ok");

  const beh = rec({ DOI: "10.1234/beh", title: "Modeling the behavior of cucumber breeding lines in film greenhouses", year: 2020, authors: ["Writer"] });
  r = await run(item({ fields: { title: "Modelling the behaviour of cucumber breeding lines in film green houses", DOI: "10.1234/beh", date: "2020" }, creators: ["Writer"] }), { cr: [beh] });
  check("a spelling variant: ok, not a title mismatch (" + r.v.status + ")", r.v.status === "ok" && r.v.titleMismatch === false);

  const fmcReview = rec({ DOI: "10.2307/2309264", title: "Finite Markov Chains.", year: 1960, authors: ["Doob"], journal: "The American Mathematical Monthly" });
  r = await run(item({ fields: { title: "Finite Markov Chains", date: "1960" }, creators: ["Kemeny", "Snell"], type: "book" }), { search: [fmcReview], cr: [fmcReview] });
  check("a book item is never settled on a journal item with its title (" + r.v.status + ")", r.v.status === "needs-attention" && r.v.work === null && r.v.suggestion && r.v.suggestion.doi === "10.2307/2309264" && r.notes.includes("a journal item in The American Mathematical Monthly, but the reference reads as a book"));
  const fmcBook = rec({ DOI: "10.1000/fmc", title: "Finite Markov Chains", year: 1960, authors: ["Kemeny", "Snell"], type: "book" });
  r = await run(item({ fields: { title: "Finite Markov Chains", date: "1960" }, creators: ["Kemeny", "Snell"], type: "book" }), { search: [fmcBook], cr: [fmcBook] });
  check("the same book item matched to a book record: ok (" + r.v.status + ")", r.v.status === "ok");
  r = await run(item({ fields: { title: "Finite Markov Chains", date: "1960" }, creators: ["Doob"], type: "journalArticle" }), { search: [fmcReview], cr: [fmcReview] });
  check("a journal-article item matched to the journal item: ok (" + r.v.status + ")", r.v.status === "ok");

  const wv = rec({ DOI: "10.1000/webvoyager", title: "WebVoyager: Building an End-to-End Web Agent with Large Multimodal Models", year: 2024, authors: ["He", "Yao", "Ma"] });
  r = await run(item({ fields: { title: "WebVoyager: Building an End-to-End Web Agent with Large Multimodal Models", date: "2024" }, creators: ["Doe", "Smith"] }), { search: [wv], cr: [wv] });
  check("an exact title whose record names none of the item's creators: needs-attention, work kept (" + r.v.status + ")", r.v.status === "needs-attention" && r.v.work && r.v.work.doi === "10.1000/webvoyager" && r.notes.includes("none of the cited authors is among its authors (He, Yao, Ma)"));

  const retracted = rec({ DOI: "10.1111/srt.13459", title: "RETRACTED: Dermoscopic and reflectance confocal microscopic features of children scabies", year: 2023, authors: ["Guan", "Bi", "Li"] });
  r = await run(item({ fields: { title: "Dermoscopic and reflectance confocal microscopic features of children scabies", date: "2023" }, creators: ["Guan"] }), { search: [retracted], cr: [retracted] });
  check("a record renamed 'RETRACTED: X' matches an item titled X (" + r.v.status + ")", r.v.resolved && r.v.work && r.v.work.doi === "10.1111/srt.13459" && r.v.weakMatch === false);

  const ipcc = rec({ DOI: "10.1017/9781009157896", title: "Climate Change 2021 – The Physical Science Basis", year: 2023, type: "book", authors: ["Intergovernmental Panel on Climate Change (IPCC)"] });
  r = await run(item({ fields: { title: "Climate Change 2021: The Physical Science Basis", DOI: "10.1017/9781009157896", date: "2021" }, creators: ["Intergovernmental Panel on Climate Change"], type: "book" }), { cr: [ipcc] });
  check("a book cited by an earlier year than its record: ok (" + r.v.status + ")", r.v.status === "ok");
  r = await run(item({ fields: { title: "Climate Change 2021: The Physical Science Basis", DOI: "10.1017/9781009157896", date: "2027" }, creators: ["Intergovernmental Panel on Climate Change"], type: "book" }), { cr: [ipcc] });
  check("a book cited by a later year: needs-attention (" + r.v.status + ")", r.v.status === "needs-attention" && r.notes.includes("the record gives the year 2023 and the citation 2027"));

  console.log(failed ? "FAILED: " + failed : "all passed");
  if (failed) { process.exit(1); }
}
main().catch((e) => { console.log("ERROR " + (e && e.stack)); process.exit(1); });
