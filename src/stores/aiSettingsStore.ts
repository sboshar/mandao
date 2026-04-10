import { create } from 'zustand';

export type AIProvider = 'mandao' | 'openai' | 'anthropic' | 'gemini';

export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  apiKey: string;
  model: string;
  /** Custom endpoint URL (optional — overrides default provider URL) */
  endpointUrl: string;
}

interface AISettingsState extends AISettings {
  update: (patch: Partial<AISettings>) => void;
  clear: () => void;
}

const STORAGE_KEY = 'mandao_ai_settings';

const DEFAULTS: AISettings = {
  enabled: false,
  provider: 'mandao',
  apiKey: '',
  model: '',
  endpointUrl: '',
};

function load(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function persist(settings: AISettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  mandao: 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.0-flash',
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  mandao: 'ManDao (built-in)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

/** Providers that require the user to supply their own API key. */
export function providerNeedsKey(provider: AIProvider): boolean {
  return provider !== 'mandao';
}

export const useAISettingsStore = create<AISettingsState>(() => {
  const initial = load();

  return {
    ...initial,
    update: (patch) => {
      const prev = useAISettingsStore.getState();
      const next: AISettings = {
        enabled: patch.enabled ?? prev.enabled,
        provider: patch.provider ?? prev.provider,
        apiKey: patch.apiKey ?? prev.apiKey,
        model: patch.model ?? prev.model,
        endpointUrl: patch.endpointUrl ?? prev.endpointUrl,
      };
      persist(next);
      useAISettingsStore.setState(next);
    },
    clear: () => {
      persist(DEFAULTS);
      useAISettingsStore.setState(DEFAULTS);
    },
  };
});
