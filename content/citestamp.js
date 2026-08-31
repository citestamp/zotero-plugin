// CiteStamp for Zotero — controller.
//
// Two surfaces, both reusing the ported citation-health core
// (CiteStampCheckCore, loaded by bootstrap.js). Everything runs locally in
// Zotero's privileged context: DOI/title queries go straight to OpenAlex /
// Crossref / CiteStamp's public CORS-open graph; nothing about the library is
// posted to a CiteStamp server. The only thing that leaves the plugin is the
// user clicking "Claim / sign on citestamp.com", which opens the hosted claim
// flow in the browser (server-side ORCID signing — never reimplemented here).
//
// Rule 1: we never say a citation is true / false / verified / fact-checked.
// We report resolvability, recorded refutations, and publisher retraction
// notices — each checkable and sourced.

var CiteStamp = {
  id: null,
  version: null,
  rootURI: null,
  paneID: null,
  menuID: null,

  init: function ({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.registerSection();
    this.registerMenu();
  },

  destroy: function () {
    this.unregisterSection();
    this.unregisterMenu();
  },

  // ---- item-pane section (global, Zotero ItemPaneManager) -----------------

  registerSection: function () {
    var self = this;
    var rootURI = this.rootURI;
    try {
      if (!Zotero.ItemPaneManager || !Zotero.ItemPaneManager.registerSection) {
        Zotero.debug("CiteStamp: ItemPaneManager unavailable; menu action only");
        return;
      }
      this.paneID = Zotero.ItemPaneManager.registerSection({
        paneID: "citestamp-health",
        pluginID: this.id,
        // The CiteStamp wax-seal mark, referenced via rootURI — the documented
        // Zotero way to point a section icon at a file shipped inside the plugin
        // (rootURI is a jar: URL for an installed xpi; that is expected and
        // works — chrome.manifest registration was the wrong path and rendered
        // blank). One SVG scales for both the 16px header and 20px sidenav.
        header: {
          l10nID: "citestamp-itempane-header",
          icon: rootURI + "content/seal.svg",
        },
        sidenav: {
          l10nID: "citestamp-itempane-sidenav",
          icon: rootURI + "content/seal.svg",
        },
        // A valid bodyXHTML is REQUIRED: without it Zotero never builds a body
        // div and never invokes the render hooks. The html: prefix must be
        // declared (xmlns:html) or the invalid XML aborts section registration.
        bodyXHTML: '<html:div xmlns:html="http://www.w3.org/1999/xhtml" class="citestamp-body" style="white-space:pre-line;padding:2px 0;line-height:1.4;">Checking citation health...</html:div>',
        // onRender is SYNCHRONOUS in Zotero 8/9 (SectionHook.render -> void);
        // the network check is async so it lives in onAsyncRender, which Zotero
        // awaits before finalizing the body. We render with plain textContent
        // (the canonical Zotero pattern) — createElementNS in the XUL item-pane
        // document was throwing into the catch and leaving the body empty.
        onRender: function (args) {
          self.renderSync(args);
        },
        onAsyncRender: function (args) {
          return self.renderAsync(args);
        },
      });
    } catch (e) {
      Zotero.debug("CiteStamp: registerSection failed (" + (e && e.message) + "); menu action still available");
    }
  },

  unregisterSection: function () {
    try {
      if (this.paneID && Zotero.ItemPaneManager && Zotero.ItemPaneManager.unregisterSection) {
        Zotero.ItemPaneManager.unregisterSection(this.paneID);
      }
    } catch (e) {
      Zotero.debug("CiteStamp: unregisterSection failed (" + (e && e.message) + ")");
    }
    this.paneID = null;
  },

  // ---- item context menu (global, Zotero 8+ MenuManager) ------------------
  // Replaces per-window XUL DOM injection: one declarative registration that
  // Zotero applies to every main window automatically.

  registerMenu: function () {
    var self = this;
    try {
      if (!Zotero.MenuManager || !Zotero.MenuManager.registerMenu) {
        Zotero.debug("CiteStamp: MenuManager unavailable; item-pane section only");
        return;
      }
      this.menuID = Zotero.MenuManager.registerMenu({
        menuID: "citestamp-check",
        pluginID: this.id,
        target: "main/library/item",
        menus: [
          {
            menuType: "menuitem",
            l10nID: "citestamp-itemmenu-check",
            onCommand: function (event, context) {
              self.runCheckOnSelection(context);
            },
          },
        ],
      });
    } catch (e) {
      Zotero.debug("CiteStamp: registerMenu failed (" + (e && e.message) + "); item-pane section still available");
    }
  },

  unregisterMenu: function () {
    try {
      if (this.menuID && Zotero.MenuManager && Zotero.MenuManager.unregisterMenu) {
        Zotero.MenuManager.unregisterMenu(this.menuID);
      }
    } catch (e) {
      Zotero.debug("CiteStamp: unregisterMenu failed (" + (e && e.message) + ")");
    }
    this.menuID = null;
  },

  // ---- Fluent label injection (per window) --------------------------------
  // The item-pane header and the menu label resolve through Fluent; inject the
  // auto-registered .ftl into each main window so labels render immediately.

  injectFTLAllWindows: function () {
    var windows = Zotero.getMainWindows();
    for (var i = 0; i < windows.length; i++) { this.injectFTL(windows[i]); }
  },

  injectFTL: function (window) {
    try {
      if (window && window.MozXULElement && window.MozXULElement.insertFTLIfNeeded) {
        window.MozXULElement.insertFTLIfNeeded("citestamp.ftl");
      }
    } catch (e) {
      Zotero.debug("CiteStamp: injectFTL failed (" + (e && e.message) + ")");
    }
  },

  // ---- shared: build a check-engine ref from a Zotero item ----------------

  refFromItem: function (item) {
    if (!item || !item.isRegularItem || !item.isRegularItem()) { return null; }
    var doi = "";
    try { doi = item.getField("DOI") || ""; } catch (e) { doi = ""; }
    var title = "";
    try { title = item.getField("title") || ""; } catch (e) { title = ""; }
    if (!doi && !title) { return null; }
    return { key: null, doi: doi ? doi.toLowerCase() : null, title: title || null, raw: title || doi };
  },

  // ---- item-pane render ---------------------------------------------------

  // the container created by bodyXHTML; fall back to the body itself.
  _box: function (body) {
    if (!body) { return null; }
    return body.querySelector(".citestamp-body") || body;
  },

  // Zotero attaches the render hooks' body to the live section only after
  // onAsyncRender resolves, and that attach is racy — sometimes the body (and
  // our content) is left orphaned and invisible. If it is not connected, attach
  // it into the live collapsible-section ourselves so the content displays.
  _attachIfNeeded: function (args) {
    try {
      var body = args && args.body;
      if (!body || body.isConnected) { return; }
      var doc = (args && args.doc) || body.ownerDocument || Zotero.getMainWindow().document;
      var cs = doc.querySelector('collapsible-section[data-pane*="citestamp"]');
      if (cs) { cs.appendChild(body); }
    } catch (e) {}
  },

  // run _attachIfNeeded now and again shortly after, to cover the body being
  // detached either before or just after our render.
  _ensureVisible: function (args) {
    var self = this;
    self._attachIfNeeded(args);
    try {
      var w = Zotero.getMainWindow();
      if (w && w.setTimeout) { w.setTimeout(function () { self._attachIfNeeded(args); }, 150); }
    } catch (e) {}
  },

  // sync hook (SectionHook.render -> void): immediate placeholder.
  renderSync: function (args) {
    try {
      var box = this._box(args && args.body);
      if (!box) { return; }
      var ref = this.refFromItem(args.item);
      box.textContent = ref
        ? "Checking citation health…"
        : "Select a reference with a DOI or title to check its citation health.";
      this._ensureVisible(args);
    } catch (e) {
      Zotero.debug("CiteStamp: renderSync failed (" + (e && e.message) + ")");
    }
  },

  // async hook: run the check and paint the rich verdict (with a clickable
  // claim link). Zotero awaits this, then attaches the body into the section.
  renderAsync: function (args) {
    var self = this;
    var box = this._box(args && args.body);
    if (!box) { return Promise.resolve(); }
    var doc = box.ownerDocument;
    var ref = this.refFromItem(args.item);
    if (!ref) {
      box.textContent = "Select a reference with a DOI or title to check its citation health.";
      return Promise.resolve();
    }
    box.textContent = "Checking citation health…";
    self._ensureVisible(args);
    return CiteStampCheckCore.checkOne(ref, {}).then(function (v) {
      self.paintVerdict(doc, box, ref, v);
      self._ensureVisible(args);
    }).catch(function (e) {
      box.textContent = "Could not run the check: " + (e && e.message ? e.message : "network error");
      self._ensureVisible(args);
    });
  },

  // create an HTML-namespaced element (the item-pane body is XHTML-namespaced).
  _html: function (doc, tag) {
    return doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  },

  // a styled text line
  _p: function (doc, text, opts) {
    opts = opts || {};
    var p = this._html(doc, "div");
    p.textContent = text;
    var style = "padding:2px 0; line-height:1.4;";
    if (opts.bold) { style += "font-weight:600;"; }
    if (opts.small) { style += "font-size:0.85em;"; }
    if (opts.dim) { style += "opacity:0.8;"; }
    if (opts.color) { style += "color:" + opts.color + ";"; }
    p.setAttribute("style", style);
    return p;
  },

  // a clickable link that opens in the browser via Zotero.launchURL
  _link: function (doc, text, url) {
    var a = this._html(doc, "a");
    a.textContent = text;
    a.setAttribute("href", "#");
    a.setAttribute("style", "color:#1565c0; text-decoration:underline; cursor:pointer; display:block; margin-top:6px;");
    a.addEventListener("click", function (ev) {
      ev.preventDefault();
      try { Zotero.launchURL(url); } catch (e) {}
    });
    return a;
  },

  // one line, two visually-separated tiers: signed (gold) vs inferred (steel)
  // — the same firewall the site and the extension popup draw.
  _tierLine: function (doc, signed, inferred) {
    var p = this._html(doc, "div");
    p.setAttribute("style", "padding:2px 0; line-height:1.4; font-size:0.85em;");
    var lead = this._html(doc, "span");
    lead.textContent = "In the CiteStamp graph: ";
    lead.setAttribute("style", "opacity:0.8;");
    p.appendChild(lead);
    var s = this._html(doc, "span");
    s.textContent = signed + " signed";
    s.setAttribute("style", "color:#9c6e1f; font-weight:600;");
    p.appendChild(s);
    var sep = this._html(doc, "span");
    sep.textContent = " · ";
    sep.setAttribute("style", "opacity:0.6;");
    p.appendChild(sep);
    var m = this._html(doc, "span");
    m.textContent = inferred + " machine-inferred";
    m.setAttribute("style", "color:#5d6675;");
    p.appendChild(m);
    return p;
  },

  // rich verdict: status headline (colored), work metadata, refutations /
  // retraction lines, and clickable doi.org + claim links. Rule-1 wording.
  paintVerdict: function (doc, body, ref, v) {
    while (body.firstChild) { body.removeChild(body.firstChild); }

    var head, color;
    if (v.status === "unchecked") { head = "Couldn't check — the lookup services did not answer. Try again."; color = "#b26a00"; }
    else if (v.status === "no-match") { head = "No confident match in the title search — not verified."; color = "#b26a00"; }
    else if (!v.resolved && v.inGraph) { head = "Not in the major open databases — but it is in the CiteStamp graph."; color = "#b26a00"; }
    else if (!v.resolved) { head = "Could not find this reference in the open databases or the CiteStamp graph."; color = "#b26a00"; }
    else if (v.status === "marked-retracted") { head = "Marked retracted by the publisher (best-effort)."; color = "#c62828"; }
    else if (v.status === "has-refutations") { head = v.refutations + (v.refutations === 1 ? " recorded refutation" : " recorded refutations") + " in the CiteStamp graph."; color = "#c62828"; }
    else if (v.status === "doi-title-mismatch") { head = "This DOI resolves, but to a different work than the cited title — check which one you meant."; color = "#b26a00"; }
    else if (v.status === "needs-attention") { head = "Resolves, but the closest open match is weak — confirm this is the work you meant."; color = "#b26a00"; }
    else { head = "Resolves to a real work."; color = "#2e7d32"; }
    body.appendChild(this._p(doc, head, { bold: true, color: color }));

    if (v.resolved && v.work) {
      var meta = [];
      if (v.work.title) { meta.push(v.work.title); }
      if (v.work.year) { meta.push("(" + v.work.year + ")"); }
      if (meta.length) { body.appendChild(this._p(doc, meta.join(" "), { dim: true })); }
      if (v.work.doi) { body.appendChild(this._link(doc, "View on doi.org →", "https://doi.org/" + v.work.doi)); }
    }

    // Soft-honor (1.0.4): Zotero has flagged retractions via the Retraction
    // Watch database since 2019, so a clean/unknown retraction line here only
    // duplicated the host. The marked-retracted headline above and its
    // provenance line below STAY — detection unchanged, no-news line gone.
    var prov = CiteStampCheckCore.provenanceLine(v.publisherEvent);
    if (prov) { body.appendChild(this._p(doc, prov, { small: true, dim: true })); }
    if (v.refutations > 0 && v.refutationSources && v.refutationSources.length) {
      body.appendChild(this._p(doc, "Recorded by: " + v.refutationSources.join(", "), { small: true, dim: true }));
    }
    // Typed replication outcomes (FORRT Replication Database) — inferred tier,
    // own lines, never folded into the signed refutation count above.
    if (v.fredFailed > 0) {
      body.appendChild(this._p(doc, v.fredFailed + " failed replication" + (v.fredFailed === 1 ? "" : "s") + " recorded (FORRT)", { small: true, color: "#b26a00" }));
    }
    if (v.fredSuccessful > 0) {
      body.appendChild(this._p(doc, v.fredSuccessful + " successful replication" + (v.fredSuccessful === 1 ? "" : "s") + " recorded (FORRT)", { small: true, color: "#2e7d32" }));
    }
    var graphTotal = (v.graphSigned || 0) + (v.graphInferred || 0);
    if (graphTotal > 0) {
      body.appendChild(this._tierLine(doc, v.graphSigned || 0, v.graphInferred || 0));
    }
    for (var i = 0; i < (v.notes || []).length; i++) {
      body.appendChild(this._p(doc, v.notes[i], { small: true, dim: true }));
    }
    if (v.suggestion && v.suggestion.title) {
      body.appendChild(this._p(doc, "Closest match: " + v.suggestion.title + (v.suggestion.year ? " (" + v.suggestion.year + ")" : ""), { small: true, dim: true }));
      if (v.suggestion.doi) { body.appendChild(this._link(doc, "View closest match on doi.org →", "https://doi.org/" + v.suggestion.doi)); }
    }
    var graphDoi = (v.work && v.work.doi) || ref.doi;
    if (graphTotal > 0 && graphDoi) {
      body.appendChild(this._link(doc, "Open citation graph on citestamp.com →", "https://citestamp.com/paper/" + graphDoi.split("/").map(encodeURIComponent).join("/")));
    }
    if (ref.doi) {
      body.appendChild(this._link(doc, "Claim / sign your work on citestamp.com →", "https://citestamp.com/claim?paper=" + encodeURIComponent(ref.doi)));
    }
    body.appendChild(this._p(doc, "Checked in Zotero — your library is never sent to CiteStamp.", { small: true, dim: true }));
  },


  // ---- menu action: check the current selection ---------------------------

  // `context` is the MenuManager onCommand context. Its exact shape varies, so
  // we derive the selection and window defensively (prefer context.items, else
  // fall back to the active Zotero pane).
  runCheckOnSelection: function (context) {
    var self = this;
    var win = (Zotero.getMainWindow && Zotero.getMainWindow()) || null;
    var pane = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
    if (!win && pane && pane.document) { win = pane.document.defaultView; }

    var items = [];
    if (context && context.items && context.items.length) { items = context.items; }
    else if (pane) { items = pane.getSelectedItems() || []; }

    var refs = [];
    var skipped = 0;
    for (var i = 0; i < items.length; i++) {
      var ref = this.refFromItem(items[i]);
      if (ref) { refs.push(ref); } else { skipped++; }
    }
    if (!refs.length) {
      this.alert(win, "Select one or more references (with a DOI or title) to check.");
      return;
    }

    var pw = null;
    try {
      pw = new Zotero.ProgressWindow({ closeOnClick: false });
      pw.changeHeadline("CiteStamp — checking " + refs.length + (refs.length === 1 ? " reference…" : " references…"));
      pw.show();
    } catch (e) { pw = null; }

    var checks = refs.map(function (r) { return CiteStampCheckCore.checkOne(r, {}); });
    Promise.all(checks).then(function (verdicts) {
      if (pw) { try { pw.close(); } catch (e) {} }
      self.summarize(win, verdicts, skipped);
    }).catch(function () {
      if (pw) { try { pw.close(); } catch (e) {} }
      self.alert(win, "The check could not complete (network error). Try again.");
    });
  },

  summarize: function (window, verdicts, skipped) {
    var counts = { resolved: 0, unresolved: 0, noMatch: 0, unchecked: 0, refuted: 0, retracted: 0, weak: 0, mismatch: 0, fredFailed: 0 };
    var flagged = [];
    for (var i = 0; i < verdicts.length; i++) {
      var v = verdicts[i];
      if (!v) { continue; }
      // A weak match or a DOI-title disagreement resolves to a candidate but
      // is uncertain — count it apart from "resolved". A lookup outage is its
      // own bucket: it is NOT evidence the reference does not resolve.
      if (v.status === "unchecked") { counts.unchecked++; }
      else if (v.status === "no-match") { counts.noMatch++; }
      else if (v.weakMatch) { counts.weak++; }
      else if (v.titleMismatch) { counts.mismatch++; }
      else if (v.resolved) { counts.resolved++; }
      else { counts.unresolved++; }
      if (v.refutations > 0) { counts.refuted++; }
      if (v.fredFailed > 0) { counts.fredFailed++; }
      if (v.retracted === "marked") { counts.retracted++; }

      var label = (v.work && v.work.title) || (v.ref && (v.ref.title || v.ref.doi)) || "(untitled)";
      if (label.length > 70) { label = label.slice(0, 67) + "…"; }
      if (v.status === "unchecked") { flagged.push("• couldn't check (lookup services did not answer): " + label); }
      else if (v.status === "no-match") { flagged.push("• no confident match in the title search: " + label); }
      else if (!v.resolved) { flagged.push("• " + (v.inGraph ? "in CiteStamp graph only" : "not found anywhere we checked") + ": " + label); }
      else if (v.status === "marked-retracted") { flagged.push("• marked retracted (best-effort): " + label); }
      else if (v.refutations > 0) { flagged.push("• " + v.refutations + " recorded refutation(s): " + label); }
      else if (v.fredFailed > 0) { flagged.push("• " + v.fredFailed + " failed replication(s) recorded (FORRT): " + label); }
      else if (v.status === "doi-title-mismatch") { flagged.push("• DOI and cited title disagree — check which you meant: " + label); }
      else if (v.status === "needs-attention") { flagged.push("• weak match — confirm: " + label); }
    }

    var lines = [];
    lines.push("Resolves to a real work: " + counts.resolved);
    lines.push("Weak match — confirm: " + counts.weak);
    lines.push("DOI and cited title disagree — check: " + counts.mismatch);
    lines.push("Not resolved in open databases: " + counts.unresolved);
    lines.push("No confident title match — not verified: " + counts.noMatch);
    lines.push("Couldn't check (lookup unavailable): " + counts.unchecked);
    lines.push("With recorded refutations: " + counts.refuted);
    if (counts.fredFailed) { lines.push("With failed replications recorded (FORRT): " + counts.fredFailed); }
    if (counts.retracted) { lines.push("Marked retracted (best-effort): " + counts.retracted); }
    if (skipped) { lines.push("Skipped (no DOI or title): " + skipped); }
    if (flagged.length) {
      lines.push("");
      lines.push("Needs a look:");
      for (var j = 0; j < flagged.length; j++) { lines.push(flagged[j]); }
    }
    lines.push("");
    lines.push("Checked in Zotero — your library is never sent to CiteStamp.");

    this.alert(window, lines.join("\n"));
  },

  alert: function (window, message) {
    try {
      Services.prompt.alert(window, "CiteStamp — citation health", message);
    } catch (e) {
      try { window.alert(message); } catch (e2) { Zotero.debug("CiteStamp alert: " + message); }
    }
  },
};
