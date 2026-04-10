import { create } from 'zustand';

export type AIProvider = 'openai' | 'anthropic' | 'gemini';

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
  provider: 'gemini',
  apiKey: '',
  model: '',
  endpointUrl: '',
};

function load(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = { ...DEFAULTS, ...JSON.parse(raw) };
    // Migrate: if user had 'mandao' selected, switch to gemini
    if (parsed.provider === 'mandao') parsed.provider = 'gemini';
    return parsed;
  } catch {
    return DEFAULTS;
  }
}

function persist(settings: AISettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.5-flash',
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini (free)',
};

/** Popular models per provider. First entry is the default. */
export const MODEL_OPTIONS: Record<AIProvider, { id: string; label: string }[]> = {
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — smartest, 20/day free' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite — 500/day free' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — 20/day free' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash — 20/day free' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (cheap, fast)' },
    { id: 'gpt-4o', label: 'GPT-4o (smartest)' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano (cheapest)' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (cheap, fast)' },
    { id: 'claude-sonnet-4-6-20260320', label: 'Claude Sonnet 4.6 (smartest)' },
  ],
};

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
