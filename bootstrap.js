// CiteStamp for Zotero — bootstrap entry point.
//
// A Zotero 8/9 *bootstrapped* plugin (the modern API; the old XUL-overlay model
// is dead). Zotero injects `Zotero` and `Services` into this scope and calls
// the lifecycle hooks below. We load the ported citation-health core and the
// controller into this same scope (so `CiteStampCheckCore` and `CiteStamp` are
// visible to each other). The item-pane section (ItemPaneManager) and the item
// context menu (MenuManager) are registered globally in init(); the only
// per-window step is injecting the Fluent labels.

var CiteStamp;

function log(msg) {
  Zotero.debug("CiteStamp: " + msg);
}

async function startup({ id, version, rootURI }) {
  log("starting " + version);
  // load the engine port first, then the controller (same global scope)
  Services.scriptloader.loadSubScript(rootURI + "lib/check-core.js");
  Services.scriptloader.loadSubScript(rootURI + "content/citestamp.js");
  CiteStamp.init({ id, version, rootURI });
  CiteStamp.injectFTLAllWindows();
}

function onMainWindowLoad({ window }) {
  if (CiteStamp) {
    CiteStamp.injectFTL(window);
  }
}

function onMainWindowUnload({ window }) {
  // section + menu are global (torn down in shutdown); nothing per-window.
}

function shutdown() {
  log("shutting down");
  if (CiteStamp) {
    CiteStamp.destroy();
    CiteStamp = undefined;
  }
}

function install() {}

function uninstall() {}
