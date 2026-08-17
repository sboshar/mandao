/**
 * Reference translation for the analysis prompt (#185).
 *
 * Supplies an independent machine translation of the sentence, injected into
 * the prompt as the starting point for the sentence-level english. The model
 * may override it, but must declare the override so review can surface it.
 *
 * WHY AN EXTERNAL TRANSLATION AT ALL
 * The sentence-level translation used to be contaminated by whatever gloss
 * the dictionary block supplied — CC-CEDICT's /selflessness/ for 忘我 produced
 * "He is very selfless when he works" instead of "He becomes completely
 * absorbed in his work". An independent translation has no visibility into the
 * rest of the prompt, so it can't inherit that bias.
 *
 * TRANSPORT IS UNRESOLVED — see #185.
 * Cloud Translation v3 (the only version exposing general/translation-llm)
 * authenticates with OAuth bearer tokens, not API keys. This app is a browser
 * PWA with no backend, so there is nowhere safe to hold a service-account
 * credential. Until that's decided this module is configured by Vite env vars
 * and is expected to be unavailable in production, where it degrades to null
 * and the prompt simply omits the reference block.
 *
 * Options on the table:
 *   - proxy (Cloud Function / Worker) holding the credential
 *   - v2 NMT, which accepts API keys and CORS but is the weaker model
 *     ("He was extremely dedicated to his work" for the 忘我 case)
 *   - dev-only, as configured here
 */

/**
 * Which Cloud Translation model to request.
 *
 * general/translation-llm is the model behind the consumer Google Translate
 * web UI. On 他工作时非常忘我 it returns "He becomes completely engrossed in his
 * work" where the default NMT model returns "He was extremely dedicated to his
 * work" — wrong sense plus an invented past tense the Chinese doesn't express.
 *
 * translation-llm is NOT covered by the free tier: $10/M characters in and
 * $10/M out, roughly $0.0005 per sentence. Set to null to use the default NMT
 * model instead, which is free up to 500K characters/month.
 */
const TRANSLATION_MODEL: string | null = 'general/translation-llm';

/** Timeout — this call sits in front of prompt generation, so keep it short. */
const REQUEST_TIMEOUT_MS = 10_000;

interface TranslateConfig {
  project: string;
  token: string;
}

function getConfig(): TranslateConfig | null {
  const project = import.meta.env.VITE_GTRANSLATE_PROJECT;
  const token = import.meta.env.VITE_GTRANSLATE_TOKEN;
  if (!project || !token) return null;
  return { project, token };
}

/** True when a reference translation can be fetched at all. */
export function isTranslationReferenceAvailable(): boolean {
  return getConfig() !== null;
}

/**
 * Warn on a configured-but-failing lookup. Deliberately silent when
 * unconfigured — that's the expected production state, not a fault.
 *
 * Scrubs OAuth bearer tokens defensively. Google's error bodies don't echo
 * the credential today, but this lands in the console where users paste from.
 */
function warn(summary: string, detail = ''): void {
  const scrubbed = detail
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[REDACTED]')
    .slice(0, 300);
  console.warn(
    `[translationReference] ${summary} — prompt will omit the reference block.`,
    scrubbed,
  );
}

/**
 * Sentence → in-flight or resolved lookup.
 *
 * Serves two purposes. It lets the UI warm the translation ahead of time (see
 * prefetchTranslationReference), so the click that actually needs it resolves
 * instantly instead of waiting on a network round trip. And it deduplicates:
 * Copy Prompt, Auto-Analyze and Re-analyze all request the same sentence, and
 * without this each would pay for its own call.
 *
 * Only SUCCESSFUL results stay cached. Failures are evicted on settle so the
 * next attempt retries — the dev OAuth token expires hourly, and a cached null
 * would keep the reference switched off for the rest of the session even after
 * the token is refreshed.
 */
const cache = new Map<string, Promise<string | null>>();

/** Cap on distinct sentences held. Small; this is a single-sentence workflow. */
const MAX_CACHE_ENTRIES = 20;

/**
 * Fetch an independent translation of `chinese`, reusing an in-flight or
 * previously successful lookup for the same sentence.
 *
 * Never throws. Returns null when unconfigured, when the request fails, or on
 * timeout — callers treat the reference as optional and the prompt drops the
 * reference block entirely, falling back to the model's own translation.
 */
export function getTranslationReference(
  chinese: string,
): Promise<string | null> {
  const key = chinese.trim();
  if (!key) return Promise.resolve(null);

  const existing = cache.get(key);
  if (existing) return existing;

  const pending = fetchTranslation(key);
  cache.set(key, pending);

  // Map iterates in insertion order, so the first key is the oldest.
  if (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value as string);
  }

  void pending.then((result) => {
    if (result === null) cache.delete(key);
  });

  return pending;
}

/**
 * Start fetching the translation without waiting for it.
 *
 * Called when the user opens the manual-copy path, which is a screen ahead of
 * the Copy Prompt button — that gap is enough for the request to finish, so the
 * copy itself feels instant rather than stalling on the network. Fire-and-
 * forget: the result lands in the cache and any error is already swallowed and
 * logged by fetchTranslation.
 */
export function prefetchTranslationReference(chinese: string): void {
  void getTranslationReference(chinese);
}

/** Uncached single request. Callers should prefer getTranslationReference. */
async function fetchTranslation(
  chinese: string,
): Promise<string | null> {
  const config = getConfig();
  if (!config || !chinese.trim()) return null;

  const url = `https://translate.googleapis.com/v3/projects/${config.project}/locations/global:translateText`;
  const body: Record<string, unknown> = {
    contents: [chinese],
    sourceLanguageCode: 'zh',
    targetLanguageCode: 'en',
    mimeType: 'text/plain',
  };
  if (TRANSLATION_MODEL) {
    body.model = `projects/${config.project}/locations/global/models/${TRANSLATION_MODEL}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'x-goog-user-project': config.project,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      // Configured but failing is a different situation from not configured,
      // and the UI can't tell them apart — both just drop the reference block.
      // The dev token expires hourly, so this path gets hit routinely.
      const detail = await resp.text().catch(() => '');
      warn(`HTTP ${resp.status}`, detail);
      return null;
    }
    const data = await resp.json();
    const text = data?.translations?.[0]?.translatedText;
    if (typeof text !== 'string' || !text.trim()) {
      warn('response contained no translation', JSON.stringify(data));
      return null;
    }
    return text;
  } catch (e: unknown) {
    // Offline, CORS, or the 10s timeout. Non-fatal — the prompt works without
    // a reference, it just loses the anchor.
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    warn(aborted ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : 'request failed',
      e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
