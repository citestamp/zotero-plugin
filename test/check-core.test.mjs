// Node-runnable unit test for the ported citation-health core.
//
//   node zotero-plugin/test/check-core.test.mjs
//
// No vitest / no deps. We load lib/check-core.js (a plain script that assigns
// `var CiteStampCheckCore`) into a Function with an injected mock `fetch`, then
// drive checkOne through four cases: a good DOI, a bogus DOI, a DOI with a
// recorded refutation, and a retracted work. Mocked network = no OpenAlex
// budget spend, deterministic.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/check-core.js", import.meta.url), "utf8");

function res(status, body) {
  return Promise.resolve({
    status: status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body || {}),
  });
}

function mockFetch(url) {
  const has = (t) => url.toLowerCase().indexOf(t) >= 0;
  const isOA = has("api.openalex.org");
  const isCR = has("api.crossref.org");
  const isGraph = has("citestamp.com/api/v1/graph");

  if (isGraph) {
    if (has("10.1/refuted")) {
      const target = "https://doi.org/10.1/refuted";
      return res(200, {
        id: target,
        edges: [{ predicate: "refutes", object: target, tier: "asserted", attribution: "Curie" }],
      });
    }
    if (has("10.1/replicated")) {
      const t2 = "https://doi.org/10.1/replicated";
      return res(200, {
        id: t2,
        edges: [
          { subject: "https://doi.org/10.2/rep1", predicate: "refutes", object: t2, tier: "inferred", attribution: "forrt-fred" },
          { subject: "https://doi.org/10.2/rep2", predicate: "supports", object: t2, tier: "inferred", attribution: "forrt-fred" },
          { subject: "https://doi.org/10.2/citer", predicate: "cites", object: t2, tier: "inferred", attribution: "openalex-extracted" },
        ],
      });
    }
    if (has("10.9/ingraph")) {
      const target = "https://doi.org/10.9/ingraph";
      return res(200, {
        id: target,
        edges: [{ subject: "https://doi.org/10.5281/zenodo.1", predicate: "cites", object: target, tier: "inferred", attribution: "zenodo-depositor-declared" }],
      });
    }
    return res(200, { id: null, edges: [] });
  }

  if (isOA) {
    if (has("/works?search=")) {
      // whole title-search API down (429 budget wall) for these queries
      if (has("warp") || has("offline") || has("attention") || has("halfdown")) { return res(429, {}); }
      // out-of-budget 200 with an ERROR body (no results array)
      if (has("budgeterr")) { return res(200, { error: "no budget left" }); }
      // low-overlap candidate: never clears a gate, becomes the suggestion
      if (has("carryover")) {
        return res(200, { results: [ { id: "https://openalex.org/W_agri", doi: "https://doi.org/10.1/agri", title: "Carryover effects in agricultural crop rotation", display_name: "Carryover effects in agricultural crop rotation", publication_year: 2010, is_retracted: false } ] });
      }
      if (has("seagull")) {
        return res(200, { results: [ { id: "https://openalex.org/W_gull", doi: "https://doi.org/10.1/gull", title: "Dynamics of coastal seagull foraging", display_name: "Dynamics of coastal seagull foraging", publication_year: 2019, is_retracted: false } ] });
      }
      // Title-search case for the stopword moat: searching the p53 title
      // returns the BRCA1 paper (differs by one content word).
      if (has("p53")) {
        return res(200, { results: [ { id: "https://openalex.org/W_brca1", doi: "https://doi.org/10.1/brca1", title: "The role of BRCA1 in cancer", display_name: "The role of BRCA1 in cancer", publication_year: 2015, is_retracted: false } ] });
      }
      // Containment case: a short query ("deep learning", 2 content tokens) is
      // fully contained in a much longer canonical (Jaccard < 0.4).
      if (has("deep")) {
        return res(200, { results: [ { id: "https://openalex.org/W_deep", doi: "https://doi.org/10.1/deep", title: "Deep learning for image recognition with convolutional neural networks", display_name: "Deep learning for image recognition with convolutional neural networks", publication_year: 2016, is_retracted: false } ] });
      }
      // 1-content-token query ("quantum") contained in a longer title — must
      // NOT be rescued (the >=2 content-token gate blocks "one word matches
      // anything").
      if (has("quantum mechanics query") || (has("quantum") && !has("hierarchical"))) {
        return res(200, { results: [ { id: "https://openalex.org/W_qm", doi: "https://doi.org/10.1/qm", title: "Quantum mechanics and field theory in modern physics", display_name: "Quantum mechanics and field theory in modern physics", publication_year: 1995, is_retracted: false } ] });
      }
      // Long query whose tokens happen to CONTAIN a short unrelated candidate.
      // Directional containment(query→cand) = 3/9 < 1, so NOT rescued (the old
      // min-symmetric coefficient would have scored 3/3 = 1.0 and wrongly
      // rescued via the short candidate).
      if (has("hierarchical")) {
        return res(200, { results: [ { id: "https://openalex.org/W_qec", doi: "https://doi.org/10.1/qec", title: "Quantum error channels", display_name: "Quantum error channels", publication_year: 2008, is_retracted: false } ] });
      }
      return res(404, {});
    }
    // registry-outage DOI: OpenAlex down too
    if (has("10.1111/alldown") || has("10.1/oadown")) { return res(429, {}); }
    // pattern (b): resolves clean in OpenAlex (is_retracted false); the
    // retraction lives ONLY in the paper's Crossref updated-by relation.
    if (has("10.1/updatedby")) {
      return res(200, { id: "https://openalex.org/W_ub", doi: "https://doi.org/10.1/updatedby", title: "Paper UB", display_name: "Paper UB", publication_year: 2019, is_retracted: false });
    }
    if (has("10.1/good") || has("10.1234/good")) {
      return res(200, { id: "https://openalex.org/W_good", doi: "https://doi.org/10.1/good", title: "Good Paper", display_name: "Good Paper", publication_year: 2020, is_retracted: false });
    }
    if (has("10.1/longcanon")) {
      return res(200, { id: "https://openalex.org/W_longcanon", doi: "https://doi.org/10.1/longcanon", title: "Deep learning for image recognition with convolutional neural networks", display_name: "Deep learning for image recognition with convolutional neural networks", publication_year: 2016, is_retracted: false });
    }
    if (has("10.1/refuted")) {
      return res(200, { id: "https://openalex.org/W_refuted", doi: "https://doi.org/10.1/refuted", title: "Refuted Paper", display_name: "Refuted Paper", publication_year: 2019, is_retracted: false });
    }
    if (has("10.1/replicated")) {
      return res(200, { id: "https://openalex.org/W_rep", doi: "https://doi.org/10.1/replicated", title: "Replicated Paper", display_name: "Replicated Paper", publication_year: 2017, is_retracted: false });
    }
    if (has("10.1/retracted")) {
      return res(200, { id: "https://openalex.org/W_retracted", doi: "https://doi.org/10.1/retracted", title: "Retracted Paper", display_name: "Retracted Paper", publication_year: 2018, is_retracted: true });
    }
    return res(404, {}); // bogus
  }

  if (isCR) {
    // the bibliographic (title search) fallback endpoint
    if (has("query.bibliographic")) {
      if (has("offline")) { return res(429, {}); }         // search outage on both sources
      if (has("budgeterr")) { return res(429, {}); }        // OA error-body + CR down
      if (has("warp")) {
        return res(200, { message: { items: [ { DOI: "10.1/warp", title: ["Warp drive lattice"], issued: { "date-parts": [[2021]] } } ] } });
      }
      if (has("carryover")) {
        return res(200, { message: { items: [ { DOI: "10.1/superfluid", title: ["Lattice flux dynamics in superfluid films"], issued: { "date-parts": [[2012]] } } ] } });
      }
      if (has("attention")) {
        // token-identical but word-order-different DIFFERENT work — the live
        // probe shape the strict gate must demote to weak, never "ok"
        return res(200, { message: { items: [ { DOI: "10.1/near", title: ["Is attention all you need?"], issued: { "date-parts": [[2023]] } } ] } });
      }
      return res(200, { message: { items: [] } });
    }
    if (has("10.1111/alldown")) { return res(429, {}); }       // registry did not answer
    // the retracted paper's OWN record carries updated-by (not update-to)
    if (has("10.1/updatedby")) { return res(200, { message: { DOI: "10.1/updatedby", title: ["Paper UB"], "updated-by": [{ DOI: "10.1/ub-notice", type: "retraction" }] } }); }
    // OpenAlex misses; a soft severe class the old update-to-only code dropped
    if (has("10.1/withdrawn")) { return res(200, { message: { DOI: "10.1/withdrawn", title: ["Paper WD"], "update-to": [{ DOI: "10.1/withdrawn", type: "withdrawal" }] } }); }
    if (has("10.1/good") || has("10.1234/good")) { return res(200, { message: { DOI: "10.1/good", title: ["Good Paper"], issued: { "date-parts": [[2020]] } } }); }
    if (has("10.1/refuted")) { return res(200, { message: { DOI: "10.1/refuted", title: ["Refuted Paper"], issued: { "date-parts": [[2019]] } } }); }
    if (has("10.1/replicated")) { return res(200, { message: { DOI: "10.1/replicated", title: ["Replicated Paper"], issued: { "date-parts": [[2017]] } } }); }
    if (has("10.1/retracted")) { return res(200, { message: { DOI: "10.1/retracted", title: ["Retracted Paper"], issued: { "date-parts": [[2018]] } } }); }
    return res(404, {}); // bogus + datacite-only DOIs OA/CR don't know
  }

  if (has("api.datacite.org")) {
    if (has("10.5281/zenodo.999")) {
      return res(200, { data: { id: "10.5281/zenodo.999", attributes: { doi: "10.5281/zenodo.999", titles: [{ title: "A Zenodo Preprint" }], publicationYear: 2026 } } });
    }
    if (has("10.1111/alldown")) { return res(503, {}); }      // registry did not answer
    return res(404, {}); // bogus: DataCite doesn't have it either
  }

  return res(0, {});
}

const Core = new Function("fetch", src + "; return CiteStampCheckCore;")(mockFetch);

let failures = 0;
function check(name, cond) {
  if (cond) { console.log("  ok  - " + name); }
  else { console.log("  FAIL- " + name); failures++; }
}

async function run() {
  const good = await Core.checkOne({ doi: "10.1/good", title: null });
  check("good: resolved", good.resolved === true);
  check("good: status ok", good.status === "ok");
  check("good: no refutations", good.refutations === 0);
  check("good: retracted clear", good.retracted === "clear");

  const bogus = await Core.checkOne({ doi: "10.1/bogus", title: null });
  check("bogus: not resolved", bogus.resolved === false);
  check("bogus: status does-not-resolve", bogus.status === "does-not-resolve");

  const refuted = await Core.checkOne({ doi: "10.1/refuted", title: null });
  check("refuted: resolved", refuted.resolved === true);
  check("refuted: one refutation", refuted.refutations === 1);
  check("refuted: status has-refutations", refuted.status === "has-refutations");
  check("refuted: source recorded", (refuted.refutationSources || []).indexOf("Curie") >= 0);

  // ---- typed tier: FORRT replication outcomes are separate counters ----
  const rep2 = await Core.checkOne({ doi: "10.1/replicated", title: null });
  check("forrt: resolved", rep2.resolved === true);
  check("forrt: failed replication counted", rep2.fredFailed === 1);
  check("forrt: successful replication counted", rep2.fredSuccessful === 1);
  check("forrt: NOT folded into signed refutations", rep2.refutations === 0);
  check("forrt: status stays ok (no truth verdict)", rep2.status === "ok");
  check("forrt: tier counts populated", rep2.graphSigned === 0 && rep2.graphInferred === 3);
  check("refuted: tier counts see the asserted edge", refuted.graphSigned === 1 && refuted.graphInferred === 0);

  const retracted = await Core.checkOne({ doi: "10.1/retracted", title: null });
  check("retracted: resolved", retracted.resolved === true);
  check("retracted: marked", retracted.retracted === "marked");
  check("retracted: status marked-retracted", retracted.status === "marked-retracted");

  // ---- publisher events: read BOTH update-to AND updated-by, full vocab ----
  // pattern (b): the retracted paper's OWN record carries updated-by (not
  // update-to). The old update-to-only code returned "clear" and dropped it.
  const ub = await Core.checkOne({ doi: "10.1/updatedby", title: null });
  check("updated-by: marked retracted", ub.retracted === "marked");
  check("updated-by: publisherEvent + notice recorded", !!(ub.publisherEvent && ub.publisherEvent.type === "retraction" && ub.publisherEvent.notice === "10.1/ub-notice"));
  check("updated-by: status marked-retracted", ub.status === "marked-retracted");
  // a soft severe class (withdrawal) is recognized too
  const wd = await Core.checkOne({ doi: "10.1/withdrawn", title: null });
  check("withdrawal: marked + event recorded", wd.retracted === "marked" && !!(wd.publisherEvent && wd.publisherEvent.type === "withdrawal"));

  // ---- noGraph: the unattended monitor re-check must not touch our origin ----
  let graphHits = 0;
  const spyFetch = (url) => { if (url.toLowerCase().indexOf("/api/v1/graph/") >= 0) { graphHits++; } return mockFetch(url); };
  const SpyCore = new Function("fetch", src + "; return CiteStampCheckCore;")(spyFetch);
  const mon = await SpyCore.checkOne({ doi: "10.1/refuted", title: null }, { noGraph: true });
  check("noGraph: graph endpoint never called", graphHits === 0);
  check("noGraph: refutations not counted (off the timer)", mon.refutations === 0);

  // OpenAlex + Crossref both miss; DataCite resolves (Zenodo-style deposit).
  const zenodo = await Core.checkOne({ doi: "10.5281/zenodo.999", title: null });
  check("zenodo: resolved via datacite", zenodo.resolved === true);
  check("zenodo: resolvedVia datacite-doi", zenodo.resolvedVia === "datacite-doi");
  check("zenodo: title from datacite", !!(zenodo.work && zenodo.work.title === "A Zenodo Preprint"));
  check("zenodo: year from datacite", !!(zenodo.work && zenodo.work.year === 2026));
  check("zenodo: status ok", zenodo.status === "ok");

  // bogus stays not-found even after the DataCite + graph hops, with the new note.
  check("bogus: note mentions datacite", (bogus.notes || []).join(" ").indexOf("DataCite") >= 0);
  check("bogus: note mentions graph", (bogus.notes || []).join(" ").indexOf("CiteStamp graph") >= 0);
  check("bogus: not inGraph", bogus.inGraph === false);

  // OA + CR + DataCite all miss, but the DOI is in CiteStamp's own graph.
  const ingraph = await Core.checkOne({ doi: "10.9/ingraph", title: null });
  check("ingraph: not resolved", ingraph.resolved === false);
  check("ingraph: inGraph true", ingraph.inGraph === true);
  check("ingraph: graphEdges 1", ingraph.graphEdges === 1);
  check("ingraph: tier counts populated", ingraph.graphSigned === 0 && ingraph.graphInferred === 1);
  check("ingraph: note cites CiteStamp graph", (ingraph.notes || []).join(" ").indexOf("CiteStamp citation graph") >= 0);

  // Stopword moat: a one-content-word-mutated title must NOT read as a strong
  // match. "The role of p53 in cancer" vs OpenAlex's "The role of BRCA1 in
  // cancer" was a raw Jaccard of 0.71 ("ok"); dropping stopwords makes it 0.5
  // → a weak match the reader is told to confirm, not a silent resolve.
  const weak = await Core.checkOne({ doi: null, title: "The role of p53 in cancer" });
  check("stopword: status needs-attention (not ok)", weak.status === "needs-attention");
  check("stopword: flagged weakMatch", weak.weakMatch === true);
  check("stopword: matchScore below the 0.7 strong threshold", weak.matchScore < 0.7);

  // Tally: a weak match counts as uncertain, not resolved.
  const rep = await Core.checkBibliography("The role of p53 in cancer");
  check("tally: weak counts uncertain", rep.counts.uncertain === 1);
  check("tally: weak not counted resolved", rep.counts.resolved === 0);

  // Containment rescue: a short legit title fully inside a long canonical
  // (Jaccard ~0.29, below the 0.4 weak floor) is rescued to WEAK, not reported
  // as "does not resolve". Never a clean "ok".
  const contained = await Core.checkOne({ doi: null, title: "Deep learning" });
  check("containment: rescued to needs-attention (not does-not-resolve)", contained.status === "needs-attention");
  check("containment: flagged weakMatch", contained.weakMatch === true);
  check("containment: not a strong/ok resolve", contained.status !== "ok");

  // Gate: a 1-content-token query must NOT be rescued by containment, even
  // though it is contained in the candidate — one word matches too much.
  const oneWord = await Core.checkOne({ doi: null, title: "Quantum" });
  check("containment gate: 1-token query does not resolve", oneWord.resolved === false);
  // no DOI, sources answered -> no-match, never the hard does-not-resolve.
  check("containment gate: 1-token query status no-match (no DOI)", oneWord.status === "no-match");

  // Directional gate: a LONG query whose tokens contain a SHORT unrelated
  // candidate must NOT be rescued (only ~1/3 of the query's tokens are in the
  // candidate). The old min-symmetric coefficient would have wrongly rescued.
  const longQ = await Core.checkOne({
    doi: null,
    title: "Hierarchical Bayesian calibration superconducting transmon quantum error channels readout",
  });
  check("directional gate: long query / short candidate does not resolve", longQ.resolved === false);
  check("directional gate: long query status no-match (no DOI)", longQ.status === "no-match");

  // ---- unchecked: a lookup outage must never read as does-not-resolve ----
  // DOI where OpenAlex 429s, Crossref 429s, DataCite 503s: nothing answered.
  const allDown = await Core.checkOne({ doi: "10.1111/alldown", title: null });
  check("outage doi: not resolved", allDown.resolved === false);
  check("outage doi: unchecked flag", allDown.unchecked === true);
  check("outage doi: status unchecked, NOT does-not-resolve", allDown.status === "unchecked");
  // ...but when the registries of record (Crossref + DataCite) both ANSWER
  // "not found", an OpenAlex-only outage does not soften the negative verdict.
  const oaDown = await Core.checkOne({ doi: "10.1/oadown", title: null });
  check("oa-only outage: registries answered, still does-not-resolve", oaDown.status === "does-not-resolve");
  check("oa-only outage: not unchecked", oaDown.unchecked === false);
  // title path: OpenAlex 429 AND Crossref search 429 -> unchecked.
  const offline = await Core.checkOne({ doi: null, title: "Offline manifold rendering" });
  check("outage title: status unchecked", offline.status === "unchecked");
  // a 200 with an ERROR body (out-of-budget OpenAlex) is a non-answer too.
  const budgeterr = await Core.checkOne({ doi: null, title: "Budgeterr probe title" });
  check("error-body 200: status unchecked", budgeterr.status === "unchecked");
  // one source down + the other answered-empty -> no-match, with disclosure.
  const halfdown = await Core.checkOne({ doi: null, title: "Halfdown spectral basis" });
  check("half outage: status no-match, not unchecked", halfdown.status === "no-match");
  check("half outage: one-source disclosure note", halfdown.notes.join(" ").indexOf("only one title search source answered") >= 0);
  // tally: unchecked is its own bucket, excluded from "do not resolve".
  const outRep = await Core.checkBibliography("10.1111/alldown");
  check("tally: outage counts unchecked", outRep.counts.unchecked === 1);
  check("tally: outage not counted unresolved", outRep.counts.unresolved === 0);

  // ---- DOI-title cross-check: real title + wrong DOI must not pass green ----
  const wrongDoi = await Core.checkOne({ doi: "10.1/good", title: "Neural correlates of interpretive dance" });
  check("wrong doi: resolved", wrongDoi.resolved === true);
  check("wrong doi: titleMismatch flagged", wrongDoi.titleMismatch === true);
  check("wrong doi: status doi-title-mismatch, not ok", wrongDoi.status === "doi-title-mismatch");
  const rightDoi = await Core.checkOne({ doi: "10.1/good", title: "Good Paper" });
  check("right doi: matching title still ok", rightDoi.status === "ok");
  check("right doi: no mismatch flag", rightDoi.titleMismatch === false);
  // a short cited form fully contained in the longer canonical title is fine.
  const shortForm = await Core.checkOne({ doi: "10.1/longcanon", title: "Deep learning" });
  check("short form of long canonical: not flagged", shortForm.titleMismatch === false && shortForm.status === "ok");
  // tally: a mismatch counts as uncertain, never resolved.
  const misRep = await Core.checkBibliography("@article{k1, title={Neural correlates of interpretive dance}, doi={10.1/good}}");
  check("tally: mismatch counts uncertain", misRep.counts.uncertain === 1);
  check("tally: mismatch not counted resolved", misRep.counts.resolved === 0);

  // ---- Crossref bibliographic fallback when OpenAlex is down ----
  const warp = await Core.checkOne({ doi: null, title: "Warp drive lattice" });
  check("crossref fallback: resolved", warp.resolved === true);
  check("crossref fallback: via crossref-title", warp.resolvedVia === "crossref-title");
  check("crossref fallback: exact title is ok", warp.status === "ok");
  check("crossref fallback: doi mapped", !!(warp.work && warp.work.doi === "10.1/warp"));
  // strict gate: a token-identical but word-order-different DIFFERENT work
  // (live probe: "Attention Is All You Need" -> "Is Attention All You Need?")
  // is a weak match to confirm, never a clean resolve.
  const near = await Core.checkOne({ doi: null, title: "Attention is all you need" });
  check("crossref strict gate: near-title demoted to needs-attention", near.status === "needs-attention");
  check("crossref strict gate: weakMatch flagged", near.weakMatch === true);

  // ---- formatted-reference title extraction (APA/MLA lines) ----
  const apa = Core.parseList("Vaswani, A., Shazeer, N., Parmar, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.");
  check("apa line: title extracted", apa[0].title === "Attention is all you need");
  check("apa line: no doi", apa[0].doi === null);
  const mla = Core.parseList('Vaswani, Ashish, et al. "Attention Is All You Need." Advances in Neural Information Processing Systems, 2017.');
  check("mla line: quoted title extracted", mla[0].title === "Attention Is All You Need");
  const bareT = Core.parseList("Attention is all you need");
  check("bare title: unchanged", bareT[0].title === "Attention is all you need");
  const bareD = Core.parseList("10.1103/PhysRev.47.777");
  check("bare doi: doi kept, no title", bareD[0].doi === "10.1103/physrev.47.777" && bareD[0].title === null);
  const apaDoi = Core.parseList("Vaswani, A. (2017). Attention is all you need. NeurIPS. https://doi.org/10.1234/good");
  check("apa+doi line: doi found", apaDoi[0].doi === "10.1234/good");
  check("apa+doi line: title extracted for the cross-check", apaDoi[0].title === "Attention is all you need");
  // the canonical hallucination paste end-to-end: real title, wrong DOI.
  const halluc = await Core.checkOne(apaDoi[0]);
  check("apa+wrong-doi e2e: status doi-title-mismatch", halluc.status === "doi-title-mismatch");
  // BibTeX parsing untouched by extraction.
  const bib = Core.parseBib("@article{epr, title = {Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?}, doi = {10.1103/PhysRev.47.777}}");
  check("bibtex: title from field, not extractor", bib[0].title === "Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?");

  // ---- LaTeX \\begin{thebibliography} parses one ref per \\bibitem ----
  // Regression guard for the 2026-07-14 bug: parseList line-split a
  // 10-entry bibliography into 40+ bogus refs and checked \\end{thebibliography}
  // itself. parseThebib splits on \\bibitem, folds \\newblock, strips \\textit{}.
  var BS = String.fromCharCode(92);
  var theBib = [
    BS + "begin{thebibliography}{10}",
    BS + "bibitem{landauer1961} Landauer, R. (1961). " + BS + "newblock Irreversibility and Heat Generation in the Computing Process. " + BS + "newblock " + BS + "textit{IBM Journal of Research and Development}, 5(3), 183-191.",
    BS + "bibitem{wolfram2002} Wolfram, S. (2002). " + BS + "newblock " + BS + "textit{A New Kind of Science}. " + BS + "newblock Wolfram Media.",
    BS + "end{thebibliography}",
  ].join(String.fromCharCode(10));
  var tb = Core.parseInput(theBib);
  check("thebib: 2 refs (one per bibitem), not per-line", tb.length === 2);
  check("thebib: keys captured", tb[0].key === "landauer1961" && tb[1].key === "wolfram2002");
  check("thebib: no markup leaks into raw", tb.every(function (r) { return r.raw.indexOf("newblock") < 0 && r.raw.indexOf("bibitem") < 0 && r.raw.indexOf("{") < 0; }));
  check("thebib: no thebibliography as a ref", tb.every(function (r) { return r.raw.indexOf("thebibliography") < 0; }));
  check("thebib: Landauer title extracted", (tb[0].title || "").indexOf("Irreversibility and Heat Generation") >= 0);
  check("thebib: Wolfram title clean of textit residue", (tb[1].title || "").indexOf("New Kind of Science") >= 0 && (tb[1].title || "").indexOf("textit") < 0);

  // ---- closest-match suggestion when nothing clears a gate ----
  const sugg = await Core.checkOne({ doi: null, title: "Epistemic seagull dynamics of nowhere" });
  check("suggestion: title-only miss is no-match, not does-not-resolve", sugg.status === "no-match");
  check("suggestion: noMatch flag set, unchecked NOT set (sources answered)", sugg.noMatch === true && sugg.unchecked === false);
  check("suggestion: both sources answered — no one-source disclosure", sugg.notes.join(" ").indexOf("only one title search source") < 0);
  check("suggestion: attached", !!(sugg.suggestion && sugg.suggestion.title === "Dynamics of coastal seagull foraging"));
  check("suggestion: carries year + doi", !!(sugg.suggestion && sugg.suggestion.year === 2019 && sugg.suggestion.doi === "10.1/gull"));
  // matches that DO clear a gate carry no suggestion (the work itself shows).
  check("no suggestion on weak match", weak.suggestion === null);
  check("no suggestion on ok", good.suggestion === null);
  // review fix: a suggestion captured in the OA pass must not survive a later
  // gate-clearing Crossref pass (stale "closest match" under a resolved work).
  const carry = await Core.checkOne({ doi: null, title: "Lattice flux carryover in superfluid films" });
  check("carryover: resolved weak via crossref pass", carry.resolved === true && carry.weakMatch === true);
  check("carryover: work is the crossref match", !!(carry.work && carry.work.title === "Lattice flux dynamics in superfluid films"));
  check("carryover: no stale suggestion", carry.suggestion === null);

  console.log("");
  if (failures) { console.log(failures + " FAILED"); process.exit(1); }
  console.log("all checks passed");
}

run().catch((e) => { console.error(e); process.exit(1); });
