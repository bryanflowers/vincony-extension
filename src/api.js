// Auth + AI calls. The extension reuses the user's existing vincony.com login: it reads
// the (non-httpOnly) Supabase session cookie, extracts the access token, and calls the
// same authenticated `chat` edge function the web app uses — so answers count against the
// user's account and credits, with no separate login. The chat endpoint streams SSE.
import { SUPABASE_URL, ANON_KEY, SUPABASE_REF } from "./config.js";

const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;

function chunkIndex(name, base) {
  return name === base ? 0 : (parseInt(name.slice(base.length + 1), 10) || 0);
}

// @supabase/ssr encodes the cookie payload as base64url (`-`/`_`, no padding).
// atob() only decodes standard base64, so normalize first.
function decodeBase64Url(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return atob(b);
}

/** Read + parse the @supabase/ssr session cookie (handles base64- prefix + chunking). */
export async function getSession() {
  try {
    const base = `sb-${SUPABASE_REF}-auth-token`;
    const cookies = await chrome.cookies.getAll({ domain: "vincony.com" });
    const parts = cookies.filter((c) => c.name === base || c.name.startsWith(base + "."));
    if (!parts.length) return null;
    parts.sort((a, b) => chunkIndex(a.name, base) - chunkIndex(b.name, base));
    let raw = parts.map((p) => p.value).join("");
    if (raw.startsWith("base64-")) raw = decodeBase64Url(raw.slice(7));
    const session = JSON.parse(raw);
    return session?.access_token ? session : null;
  } catch {
    return null;
  }
}

/**
 * Parse an OpenAI-style SSE stream (`data: {choices:[{delta:{content}}]}` … `data: [DONE]`),
 * mirroring the web app's parseSSEStream. Calls onChunk(delta, fullSoFar) as text arrives.
 * Returns { content, citations }.
 */
async function readSSE(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let citations;
  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "" || !line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") break outer;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onChunk?.(delta, full);
          }
          if (Array.isArray(parsed.citations) && parsed.citations.length) {
            citations = parsed.citations;
          }
        } catch {
          // malformed line — skip
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { content: full, citations };
}

/**
 * Send an OpenAI-shaped message list to the chat function and stream the reply.
 * onChunk(delta, fullSoFar) fires as tokens arrive. Returns { text, citations } or { error }.
 */
export async function askVincony(messages, model, onChunk) {
  const session = await getSession();
  if (!session?.access_token) return { error: "signin" };

  // "auto" is our UI sentinel for "let the server choose" — the chat function has no
  // smart router and rejects a literal "auto" id, so omit the field entirely (it then
  // defaults to its own model). Any other value is a real catalog id and is sent as-is.
  const realModel = model && model !== "auto" ? model : undefined;

  let res;
  try {
    res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages, ...(realModel ? { model: realModel } : {}) }),
    });
  } catch {
    return { error: "network" };
  }

  if (res.status === 401) return { error: "signin" };
  if (res.status === 402) return { error: "credits" };
  if (res.status === 429) return { error: "Too many requests — slow down a moment." };
  if (!res.ok || !res.body) {
    let e = "Something went wrong.";
    try { e = (await res.json()).error || e; } catch { /* non-JSON error */ }
    return { error: e };
  }

  const { content, citations } = await readSSE(res.body, onChunk);
  return { text: content, citations };
}

/** Grab the active tab's title/url/visible text (truncated) for "ask about this page". */
export async function getActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { title: "", url: "", text: "" };
  try {
    const [out] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: location.href,
        text: (document.body?.innerText || "").replace(/\s+\n/g, "\n").slice(0, 12000),
      }),
    });
    return out?.result || { title: tab.title || "", url: tab.url || "", text: "" };
  } catch {
    return { title: tab.title || "", url: tab.url || "", text: "" };
  }
}
