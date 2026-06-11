// Service worker: wires the toolbar button, right-click menu, and omnibox into the
// side panel. It never calls the AI directly — it stashes the user's intent in
// chrome.storage.session under `vincPending`, then opens the panel, which reads it.
import { SITE_URL } from "./config.js";

// Clicking the toolbar icon opens the side panel (Chrome/Edge).
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// Right-click menu: ask about the whole page, or about the selected text.
chrome.runtime.onInstalled.addListener(() => {
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

async function queueAndOpen(pending, tab) {
  await chrome.storage.session.set({ vincPending: { ...pending, ts: Date.now() } });
  try {
    if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
    else {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.windowId != null) await chrome.sidePanel.open({ windowId: active.windowId });
    }
  } catch {
    // open() must be called in response to a user gesture; the context-menu /
    // omnibox click qualifies. If it still fails, the panel opens on next click
    // and picks up the pending item then.
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "vinc-selection" && info.selectionText) {
    queueAndOpen({ kind: "selection", text: info.selectionText }, tab);
  } else if (info.menuItemId === "vinc-page") {
    queueAndOpen({ kind: "page" }, tab);
  }
});

// Omnibox: type "vinc <question>" in the address bar → answer in the side panel.
chrome.omnibox?.setDefaultSuggestion({
  description: "Ask Vincony — type your question and press Enter",
});
chrome.omnibox?.onInputEntered.addListener((text, disposition) => {
  const q = (text || "").trim();
  if (!q) {
    chrome.tabs.create({ url: SITE_URL });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    queueAndOpen({ kind: "ask", text: q }, tab);
  });
});
