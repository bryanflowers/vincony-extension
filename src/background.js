// Service worker: wires the toolbar button, right-click menu, and omnibox into the
// side panel. It never calls the AI directly — it opens the panel and hands it the
// user's intent, which the panel (sidepanel.js) acts on.
import { SITE_URL } from "./config.js";

// Clicking the toolbar icon opens the side panel (Chrome/Edge).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Right-click menu: ask about the whole page, or about the selected text. removeAll
// first so re-running onInstalled on an update doesn't throw "duplicate id".
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "vinc-page",
      title: "Ask Vincony about this page",
      contexts: ["page", "action"],
    });
    chrome.contextMenus.create({
      id: "vinc-selection",
      title: 'Ask Vincony about "%s"',
      contexts: ["selection"],
    });
  });
});

// Open the panel + deliver the intent. CRITICAL: sidePanel.open() must be called
// synchronously within the user gesture — awaiting anything (storage, tabs.query)
// first would consume the gesture and Chrome would refuse to open the panel. So we
// open immediately with the windowId we already have, THEN persist + broadcast.
function dispatch(pending, windowId) {
  if (windowId != null) chrome.sidePanel.open({ windowId }).catch(() => {});
  const payload = { ...pending, ts: Date.now() };
  // Cold start: the panel reads this from storage on load. Already-open: the message
  // delivers it live. sidepanel.js dedupes the two by ts.
  chrome.storage.session.set({ vincPending: payload }).catch(() => {});
  chrome.runtime.sendMessage({ type: "vincPending", pending: payload }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "vinc-selection" && info.selectionText) {
    dispatch({ kind: "selection", text: info.selectionText }, tab?.windowId);
  } else if (info.menuItemId === "vinc-page") {
    dispatch({ kind: "page" }, tab?.windowId);
  }
});

// Omnibox: type "vinc <question>" in the address bar, Enter -> answer in the side panel.
chrome.omnibox?.setDefaultSuggestion({
  description: "Ask Vincony - type your question and press Enter",
});
chrome.omnibox?.onInputEntered.addListener((text) => {
  const q = (text || "").trim();
  if (!q) {
    chrome.tabs.create({ url: SITE_URL });
    return;
  }
  // No windowId is available synchronously here, so opening a closed panel is
  // best-effort; if the panel is already open the runtime message delivers the
  // question live regardless.
  chrome.windows
    .getCurrent()
    .then((w) => dispatch({ kind: "ask", text: q }, w?.id))
    .catch(() => dispatch({ kind: "ask", text: q }));
});
