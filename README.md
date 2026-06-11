# Vincony — AI sidebar & answer engine (browser extension)

A Manifest V3 browser extension that puts Vincony's AI — **800+ models, 70+ tools** — into
Chrome, Edge, and Firefox. Ask anything from a side panel, ask about the page you're on, or
type a question straight into the address bar.

It reuses your existing **vincony.com** login (no separate sign-in) and routes every answer
through the same backend the web app uses, so usage counts against your account and credits.

## Features

- **AI side panel** — a full chat with a model picker (Auto smart-router, Gemini 3, GPT-5, Claude). Click the toolbar icon or press `Alt+Shift+V`.
- **Ask about this page** — one click sends the current page's title, URL, and visible text as context, then answers / summarizes it.
- **Right-click → Ask Vincony** — on any page, or on selected text ("Ask Vincony about …").
- **Answer-engine omnibox** — type `vinc` + space in the address bar, then your question; the answer opens in the side panel.
- **Streaming replies** with light Markdown rendering (code, bold, links) and Perplexity-style source citations.

## How auth works

Supabase stores the session in a non-`httpOnly` cookie on `vincony.com`. The extension reads
`sb-<ref>-auth-token` (handling base64 + chunked cookies), extracts the `access_token`, and
calls the `chat` edge function with `Authorization: Bearer <token>`. If you're not signed in,
a banner links you to vincony.com/auth — sign in there once and the panel works immediately.

No tokens are stored by the extension; it reads the cookie live per request.

## Install (developer / unpacked)

1. `chrome://extensions` (or `edge://extensions`) → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Pin the Vincony icon. Sign in at [vincony.com](https://vincony.com) in the same browser.

Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick `manifest.json`.
(Firefox uses the sidebar action; the side-panel API is Chromium-only — the panel still loads.)

## Project layout

```
manifest.json        MV3 manifest (sidePanel, contextMenus, omnibox, cookies, scripting)
src/config.js        Public config: Supabase URL/ref, anon key, model list
src/api.js           getSession() · askVincony() (streams /functions/v1/chat) · getActivePage()
src/background.js    Service worker: toolbar → panel, context menus, omnibox
src/sidepanel.html   Side-panel chat UI
src/sidepanel.js     Chat controller (history, streaming render, page context, pending intents)
src/sidepanel.css    Styles (auto dark/light)
icons/               16 / 48 / 128 px icons
```

## Privacy

The extension only reads page content when **you** ask it to (the "ask about this page"
button, the context menu, or a question you type). It talks to two hosts: `vincony.com`
(your session cookie) and the Vincony Supabase backend. Nothing else is collected or sent.

## Publishing

Built for the Chrome Web Store, Edge Add-ons, and Firefox AMO. Zip the folder (excluding
`.git`) and upload. Store listing copy lives in `STORE.md` (TODO) once accounts are ready.
