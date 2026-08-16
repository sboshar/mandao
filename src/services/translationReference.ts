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
 * Fetch an independent translation of `chinese`.
 *
 * Never throws. Returns null when unconfigured, when the request fails, or on
 * timeout — callers treat the reference as optional and the prompt drops the
 * reference block entirely, falling back to the model's own translation.
 */
export async function getTranslationReference(
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
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data?.translations?.[0]?.translatedText;
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    // Unconfigured, offline, expired token, CORS — all non-fatal. The prompt
    // works without a reference; it just loses the anchor.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
