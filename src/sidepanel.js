// Side-panel chat controller. Holds an in-memory message history, renders it, and
// talks to the chat function via api.js. Reads any pending intent (page/selection/
// omnibox) the service worker queued before opening the panel.
import { askVincony, getActivePage, getSession } from "./api.js";
import { MODELS, SITE_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const thread = $("thread");
const input = $("input");
const sendBtn = $("send");
const askPageBtn = $("ask-page");
const modelSel = $("model");

// OpenAI-shaped history sent to the model. Kept CLEAN: only the user's questions and
// the assistant's answers. Large page context is attached to a single request at call
// time (never stored), so we don't resend a 12k-char page blob on every later turn.
let history = [];
let busy = false;

// ---- Model picker ---------------------------------------------------------
for (const m of MODELS) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  modelSel.appendChild(opt);
}
chrome.storage.sync.get({ vincModel: MODELS[0].id }).then(({ vincModel }) => {
  if ([...modelSel.options].some((o) => o.value === vincModel)) modelSel.value = vincModel;
});
modelSel.addEventListener("change", () => {
  chrome.storage.sync.set({ vincModel: modelSel.value });
});

// ---- Rendering ------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Minimal, safe markdown. We split on fenced code blocks (keeping the delimiters via a
// capturing group) and render each segment independently — code blocks are escaped
// verbatim, prose gets inline formatting. No placeholder substitution, so nothing in
// the model's text can collide with it.
function renderMarkdown(src) {
  const segments = src.split(/(```\w*\n?[\s\S]*?```)/g);
  return segments
    .map((seg) => {
      const fence = seg.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (fence) {
        return `<pre><code>${escapeHtml(fence[2].replace(/\n$/, ""))}</code></pre>`;
      }
      let t = escapeHtml(seg);
      t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>'
      );
      return t.replace(/\n/g, "<br>");
    })
    .join("");
}

function clearEmpty() {
  const e = $("empty");
  if (e) e.remove();
}

function addMessage(role, contentHtml, { cite } = {}) {
  clearEmpty();
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "You" : "Vincony";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = contentHtml;
  if (cite) {
    const c = document.createElement("span");
    c.className = "page-cite";
    c.textContent = cite;
    bubble.appendChild(c);
  }
  wrap.append(who, bubble);
  thread.appendChild(wrap);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function addTyping() {
  clearEmpty();
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.innerHTML =
    '<div class="who">Vincony</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
  thread.appendChild(wrap);
  thread.scrollTop = thread.scrollHeight;
  return wrap;
}

const ERRORS = {
  signin: { msg: "Please sign in to Vincony to continue.", showBanner: true },
  credits: { msg: "You're out of credits. Top up on vincony.com to keep going." },
  network: { msg: "Network error - check your connection and try again." },
};

function showSignin(show) {
  $("signin").classList.toggle("hidden", !show);
}

// ---- Core send ------------------------------------------------------------
async function send(userText, { cite, contextBlock, displayText } = {}) {
  if (busy) return;
  const shown = displayText ?? userText;
  if (!shown.trim() && !contextBlock) return;
  busy = true;
  sendBtn.disabled = true;
  askPageBtn.disabled = true;

  addMessage("user", renderMarkdown(shown), { cite });
  // Store only the clean question. Any page context is attached to THIS call's payload
  // (the last message) and never persisted, so follow-up turns stay small.
  history.push({ role: "user", content: userText });
  const payload = contextBlock
    ? [...history.slice(0, -1), { role: "user", content: `${contextBlock}\n\n${userText}` }]
    : history;

  const typing = addTyping();
  const bubble = typing.querySelector(".bubble");
  // Coalesce streamed deltas to ~one render per 50ms (the model emits many tokens/sec, and
  // re-parsing the whole message on each is wasteful). A final authoritative render after the
  // stream covers any dropped trailing tick. Mirrors the web app's parseSSEStream FLUSH_MS.
  let latest = "";
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    bubble.innerHTML = renderMarkdown(latest);
    thread.scrollTop = thread.scrollHeight;
  };
  const onChunk = (_delta, full) => {
    latest = full;
    if (!flushTimer) flushTimer = setTimeout(flush, 50);
  };

  const res = await askVincony(payload, modelSel.value, onChunk);
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

  if (res.error) {
    const info = ERRORS[res.error];
    bubble.classList.add("error");
    bubble.textContent = info?.msg || res.error;
    if (info?.showBanner) showSignin(true);
    history.pop(); // don't keep an unanswered turn in context
  } else {
    const text = res.text || "";
    // Authoritative final render (covers a dropped throttle tick mid-stream).
    bubble.innerHTML = renderMarkdown(text || "(no answer)");
    if (res.citations?.length) {
      const cites = document.createElement("span");
      cites.className = "page-cite";
      cites.textContent = "Sources: " + res.citations.slice(0, 5).join("   ");
      bubble.appendChild(cites);
    }
    history.push({ role: "assistant", content: text });
  }

  busy = false;
  sendBtn.disabled = false;
  askPageBtn.disabled = false;
  input.focus();
}

// ---- Ask about the current page ------------------------------------------
async function askAboutPage(question) {
  const page = await getActivePage();
  if (!page.text) {
    addMessage(
      "assistant",
      'I could not read this page. If it is a normal website, click "Ask about this page" ' +
        'again and choose Allow, or right-click the page and pick "Ask Vincony about this page". ' +
        "(Browser system pages like the new-tab or Web Store can't be read.)"
    ).classList.add("error");
    return;
  }
  const q = question?.trim() || "Summarize this page and pull out the key points.";
  const contextBlock =
    `You are answering about the web page the user is viewing. Use it as the primary source.\n` +
    `Title: ${page.title}\nURL: ${page.url}\n\nPage content:\n"""\n${page.text}\n"""`;
  await send(q, {
    contextBlock,
    displayText: q,
    cite: page.title ? `Context: ${page.title}` : `Context: ${page.url}`,
  });
}

// Reading an arbitrary page needs host access to it. host_permissions only cover
// vincony/supabase, and a click inside the panel does NOT grant activeTab — so request
// the optional broad host permission on demand. Must be called synchronously from the
// click handler (a prior await would consume the user gesture). Resolves true if the
// extension already has, or the user grants, access.
function ensurePageAccess() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }, (granted) =>
        resolve(!!granted)
      );
    } catch {
      resolve(false);
    }
  });
}

// ---- Wiring ---------------------------------------------------------------
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = "";
  autosize();
  send(text);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}
input.addEventListener("input", autosize);

askPageBtn.addEventListener("click", async () => {
  // ensurePageAccess() fires chrome.permissions.request synchronously (preserving the
  // click gesture); the await only waits for the user's answer.
  const granted = await ensurePageAccess();
  if (!granted) {
    addMessage(
      "assistant",
      'I need permission to read the current page. Click "Ask about this page" again and ' +
        'choose Allow, or right-click the page and pick "Ask Vincony about this page".'
    ).classList.add("error");
    return;
  }
  askAboutPage();
});

$("newchat").addEventListener("click", () => {
  history = [];
  thread.innerHTML =
    '<div class="empty" id="empty"><img src="../icons/icon128.png" alt="" width="44" height="44" />' +
    "<h1>Ask anything</h1><p>Get answers from 800+ AI models. Use the button below to ask about the page you're on.</p></div>";
});

$("signin-link").href = `${SITE_URL}/auth`;

// ---- Pending intents (from the service worker) ----------------------------
// A pending intent can arrive two ways: stashed in storage.session (read on cold panel
// load) or pushed as a runtime message (when the panel is already open). Dedupe the two
// by timestamp so it's handled exactly once.
let lastHandledTs = 0;
function handlePending(p) {
  if (!p || !p.ts || p.ts === lastHandledTs) return;
  if (Date.now() - p.ts > 60000) return; // ignore stale intents
  lastHandledTs = p.ts;
  chrome.storage.session.remove("vincPending").catch(() => {});
  if (p.kind === "page") askAboutPage();
  else if (p.kind === "selection") send(`About this text:\n\n"${p.text}"`, { displayText: p.text });
  else if (p.kind === "ask") send(p.text);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "vincPending") handlePending(msg.pending);
});

// ---- Startup: auth state + any pending intent -----------------------------
async function init() {
  const session = await getSession();
  showSignin(!session);
  const { vincPending } = await chrome.storage.session.get("vincPending");
  if (vincPending) handlePending(vincPending);
  input.focus();
}
init();
