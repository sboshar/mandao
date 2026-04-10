/**
 * Pluggable AI provider — calls AI APIs from the browser.
 *
 * - "mandao" provider: routes through our Vercel API route (no user key needed)
 * - Other providers: direct browser calls using the user's own API key
 */
import { useAISettingsStore, DEFAULT_MODELS, providerNeedsKey, type AIProvider } from '../stores/aiSettingsStore';
import { supabase } from '../lib/supabase';

/** Default API endpoints for BYOK providers */
const DEFAULT_ENDPOINTS: Partial<Record<AIProvider, string>> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
};

/** Timeout for AI requests (60 seconds). */
const REQUEST_TIMEOUT_MS = 60_000;

/** Truncate API error bodies and scrub API key patterns to avoid leaking sensitive data. */
function truncateError(body: string, maxLen = 300): string {
  const truncated = body.length > maxLen ? body.slice(0, maxLen) + '…' : body;
  return truncated.replace(/\b(sk-[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]');
}

function getConfig() {
  const s = useAISettingsStore.getState();
  if (!s.enabled) throw new Error('AI features are not enabled. Go to Settings to configure.');
  if (providerNeedsKey(s.provider) && !s.apiKey) {
    throw new Error('No API key configured. Go to Settings to add one.');
  }
  const model = s.model || DEFAULT_MODELS[s.provider];
  const endpoint = s.endpointUrl || DEFAULT_ENDPOINTS[s.provider] || '';
  if (s.endpointUrl && !/^https:\/\//i.test(s.endpointUrl)) {
    throw new Error('Custom endpoint must use https://. Refusing to send API key over an insecure connection.');
  }
  return { provider: s.provider, apiKey: s.apiKey, model, endpoint };
}

/** Wrap a fetch call with an AbortController timeout. */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your network or try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── ManDao built-in (Vercel AI Gateway proxy) ────────────────────────

async function callMandao(prompt: string): Promise<string> {
  const { model } = getConfig();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be logged in to use AI features.');

  const res = await fetchWithTimeout('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ prompt, model }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `AI proxy error ${res.status}`);
  }

  const data = await res.json();
  return data.text;
}

// ── OpenAI-compatible ────────────────────────────────────────────────

async function callOpenAI(prompt: string): Promise<string> {
  const { apiKey, model, endpoint } = getConfig();

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${truncateError(body)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Anthropic ────────────────────────────────────────────────────────

async function callAnthropic(prompt: string): Promise<string> {
  const { apiKey, model, endpoint } = getConfig();

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser calls — Anthropic recommends server-side
      // proxying for production apps, but this is acceptable for a personal
      // tool where the user supplies their own key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${truncateError(body)}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// ── Gemini ───────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const { apiKey, model, endpoint } = getConfig();

  // NOTE: Gemini's REST API requires the key as a URL query parameter.
  // This means the key may appear in browser history, network logs, and
  // proxy/CDN logs. This is Google's documented API format and cannot be
  // avoided without a server-side proxy. Use a restricted API key with
  // only the Generative Language API enabled.
  const url = `${endpoint}/${model}:generateContent?key=${apiKey}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${truncateError(body)}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ── Public API ───────────────────────────────────────────────────────

const PROVIDERS: Record<AIProvider, (prompt: string) => Promise<string>> = {
  mandao: callMandao,
  openai: callOpenAI,
  anthropic: callAnthropic,
  gemini: callGemini,
};

/** Send a prompt to the configured AI provider and return the raw text response. */
export async function generateCompletion(prompt: string): Promise<string> {
  const { provider } = getConfig();
  return PROVIDERS[provider](prompt);
}

/** Check whether AI is configured and ready to use. */
export function isAIConfigured(): boolean {
  const s = useAISettingsStore.getState();
  if (!s.enabled) return false;
  // ManDao built-in doesn't need a key; BYOK providers do
  return s.provider === 'mandao' || !!s.apiKey;
}
