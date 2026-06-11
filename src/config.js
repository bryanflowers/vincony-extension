// Public config — the anon/publishable key is safe to embed (it's in the web bundle too).
export const SUPABASE_URL = "https://cyntatcliohzvhmzpfkb.supabase.co";
export const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5bnRhdGNsaW9oenZobXpwZmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjM2MjMsImV4cCI6MjA4OTAzOTYyM30.4kYZAm3ye_R7E8kH8h6pWWenS6MJwOZVnau0K-1hwVI";
export const SUPABASE_REF = "cyntatcliohzvhmzpfkb";
export const SITE_URL = "https://vincony.com";
export const APP_URL = "https://app.vincony.com";
// A small default set the side panel exposes. IDs must match the live chat catalog
// (src/data/chatModelCatalog.json in the main app). "auto" is a sentinel meaning
// "send no model field" so the server picks its own default (api.js omits it) —
// the chat function does NOT accept a literal "auto" model id.
export const MODELS = [
  { id: "auto", label: "Auto · Vincony default" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash · fast" },
  { id: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "google/gemini-3-pro-preview", label: "Gemini 3 Pro" },
];
