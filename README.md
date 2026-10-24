# CiteStamp for Zotero

A plugin for **Zotero 8 and later** that brings CiteStamp's **citation-health check** into the
reference manager itself, the same engine that rides the web `/check` page, the
Overleaf wrapper and the Microsoft Word add-in (a Google Docs add-on is coming). For
any item it answers, in plain record language (never true, false or verified):

- **does this reference resolve to a real work?** (catches invented citations)
- **does it have recorded refutations** in the CiteStamp graph? (signed edges only)
- **does it have recorded replication outcomes?** Typed supports/refutes edges
  coded by the FORRT Replication Database (inferred tier, shown as
  "N failed/successful replication(s) recorded (FORRT)", never folded into the
  signed refutation count).
- **how connected is it?** Signed and machine-inferred edge counts from the
  public graph, plus a one-click **"Open citation graph on citestamp.com"** link
  to the paper's interactive graph.

…and offers a one-click **"Claim / sign on citestamp.com"** that opens the
hosted ORCID claim flow in your browser, so you can put your name on your own
work.

A paper its publisher has **marked retracted** is still flagged, best-effort, with
the engine's provenance line. Since 1.0.4 the pane prints a retraction row **only
when a retraction is actually flagged**: Zotero itself has flagged retracted items
against the Retraction Watch database since 2019, so a "not marked retracted" line
on every clean item duplicated the host. Detection is unchanged; the no-news line
is gone.

## Why a Zotero bootstrapped plugin (and not a Worker route)

Zotero is a **desktop app** (Gecko/Firefox-based, runs locally), no Cloudflare
Worker can reach it, and there is no web DOM to inject into. So this is a
**bootstrapped plugin for Zotero 8 and later** (the modern API; the old XUL-overlay model is
dead). It runs in Zotero's **privileged JS context**, where `fetch` has no CORS
constraint, so the citation-health logic runs entirely on the user's machine.
It targets Zotero **8.0 and up** (`strict_min_version` `8.0`,
`strict_max_version` a concrete `10.99.99`, Gecko 140 rejects a wildcard
ceiling), the menu uses `Zotero.MenuManager`, which is Zotero 8+.

## Architecture: reuse, don't fork

- **`lib/check-core.js`** is a faithful **port of `the served check.js`** (the
  served citation-health engine). That file is a cooked Worker *template string*
  that attaches to `window.CiteStampCheck`; this port rewraps the identical
  scanner/resolve/refutation/retraction logic to return a plain
  `CiteStampCheckCore` object for Zotero's `window`-less scope. **Keep the two
  in sync**, same accepted duplication as the gdocs a/b/c disambiguation. The
  resolve path is client-direct: DOI → OpenAlex → Crossref → **DataCite**
  fallback (so data/preprint deposits like Zenodo, which citation databases
  don't index, still resolve) → **doi.org** registration check for a DOI none
  of them holds (registered with another agency reads as uncertain, never as
  missing; since 1.0.5), or title → OpenAlex search; refutations and
  retraction come from CiteStamp's public, CORS-open graph endpoint with a bare
  identifier.
- **`content/citestamp.js`** is the controller. Two surfaces:
  1. an **item-pane section** (`Zotero.ItemPaneManager.registerSection`) that
     checks the selected item and renders the verdict;
  2. an **item context-menu** action, *"Check citation health (CiteStamp)"*,
     registered declaratively via `Zotero.MenuManager.registerMenu` (Zotero 8+,
     applied to every main window automatically, no per-window DOM injection),
     that checks the whole selection and shows a summary.
- **`bootstrap.js`** is the Zotero lifecycle entry (`startup` / `shutdown` /
  `onMainWindowLoad` / `onMainWindowUnload`); it loads the core + controller,
  registers the global section + menu, and injects the Fluent labels per window.
- The hosted service is **untouched**. It keeps serving the
  engines. Signing stays server-side: the plugin never reimplements
  ORCID OAuth; it just launches `citestamp.com/claim?paper=<doi>`.

> This dir supersedes an earlier Phase-4 prototype that talked to a localhost
> grounding bridge (`http://127.0.0.1:1701`) and carried a wrong plugin id. The
> localhost model and `chrome.manifest` are both gone. The item-pane icon is
> referenced the documented Zotero way, `rootURI + "content/seal.svg"` (an
> earlier attempt to register it over `chrome://` via `chrome.manifest` rendered
> blank; `rootURI` is the supported path, even though it resolves to a `jar:`
> URL for an installed xpi).

## Privacy

Everything runs locally in Zotero. DOI/title queries go from your machine
straight to OpenAlex / Crossref / DataCite / doi.org / CiteStamp's public graph; **nothing about your
library is posted to a CiteStamp server.** The only thing that ever leaves the
plugin is an explicit, user-initiated ORCID-signed claim, and that happens in
your browser, on the hosted claim page, not in the plugin.

## Entity

CiteStamp is owned by **3Rivers Enterprises LLC**. The plugin id is
`citestamp@citestamp.com`. (CiteStamp and ICSAC are separate legal entities;
they only share a founder.)

## Files

| File | Role |
|------|------|
| `manifest.json` | Zotero manifest (`applications.zotero`, id, version range 8.0–10.99.99) |
| `bootstrap.js` | Lifecycle hooks; loads the core + controller; registers section + menu |
| `lib/check-core.js` | Ported citation-health engine (keep in sync with `check-js.ts`) |
| `content/citestamp.js` | Item-pane section + MenuManager context action + render |
| `content/seal.svg` | CiteStamp wax-seal item-pane icon (referenced via `rootURI`) |
| `locale/en-US/citestamp.ftl` | Item-pane + menu labels (Fluent, auto-registered) |
| `icon.png` | Plugin-manager listing icon |
| `test/check-core.test.mjs` | Node unit test for the ported core (mocked network) |

## Test the core (local, no Zotero)

```bash
node test/check-core.test.mjs
```

Mocks OpenAlex/Crossref/DataCite/graph and drives `checkOne` through a good DOI,
a bogus DOI, a DOI with a recorded refutation, a retracted work, a
DataCite-only (Zenodo-style) DOI, and the doi.org registration check (a DOI
registered with another agency; a DOI typo on a real title). No network spend.

## Build & install in Zotero (8 and later)

**Build the `.xpi`** (a plain zip of the plugin *contents*, not the folder, so
`manifest.json` sits at the archive root), with exactly the seven files the
served .xpi carries:

```bash
./package.sh
```

**Install:** Zotero → **Tools → Plugins** → gear menu → **Install Plugin From
File…** → pick `citestamp-zotero.xpi`.

**Dev-load (live edits):** create a text file named after the plugin id
(`citestamp@citestamp.com`) in your Zotero profile's `extensions/` directory
whose only content is the absolute path to this `zotero-plugin/` folder, then
restart Zotero. See the Zotero plugin docs for the proxy-file workflow.

## Verify in Zotero (real e2e)

Zotero is a desktop GUI and can't run headless. On a machine with Zotero 8 or later:

1. Add three items: one with a **good DOI**, one with a **bogus DOI**, one with
   a **DOI that has a recorded refutation** in the CiteStamp graph.
2. Select each, the **CiteStamp** item-pane section should show the right
   verdict ("resolves to a real work" / "could not find this reference in
   the open scholarly record" / "N recorded refutations" / "marked retracted
   (best-effort)"), plus the signed/inferred edge counts and any
   "failed/successful replication(s) recorded (FORRT)" lines.
3. Right-click the selection → **Check citation health (CiteStamp)** → confirm
   the summary counts.
4. Click **Open citation graph on citestamp.com →** → confirm it opens
   `citestamp.com/paper/<doi>` in your browser.
5. Click **Claim / sign on citestamp.com →** → confirm it opens
   `citestamp.com/claim?paper=<doi>` in your browser.


## Source of truth

This repository mirrors the plugin source that ships in the published .xpi (install from https://citestamp.com/get; auto-updates from citestamp.com/zotero/updates.json). `package.sh` builds an .xpi with the same seven files as the served one (manifest.json, bootstrap.js, icon.png, content/, lib/, locale/); its zip metadata differs, so to check the shipped bytes, unzip the served .xpi and compare its files with this tree. The service behind it (citestamp.com) is not open source; its signed log is: https://github.com/citestamp/op-log

## License

MIT, see LICENSE.
