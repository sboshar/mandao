import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  useAISettingsStore,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  providerNeedsKey,
  type AIProvider,
} from '../stores/aiSettingsStore';
import { generateCompletion } from '../services/aiProvider';

const PROVIDERS: AIProvider[] = ['mandao', 'openai', 'anthropic', 'gemini'];

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useAISettingsStore();
  const update = useAISettingsStore((s) => s.update);

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const needsKey = providerNeedsKey(settings.provider);

  const handleProviderChange = (provider: AIProvider) => {
    update({ provider, model: '', endpointUrl: '', apiKey: '' });
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await generateCompletion('Reply with exactly: "ok"');
      if (reply.toLowerCase().includes('ok')) {
        setTestResult({ ok: true, message: 'Connection successful!' });
      } else {
        setTestResult({ ok: true, message: `Got response: "${reply.slice(0, 80)}"` });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
    }
    setTesting(false);
  };

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
      </div>

      {/* AI Configuration */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">AI-Powered Analysis</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Automatically analyze sentences instead of copy-pasting to an LLM.
            </p>
          </div>
          <button
            onClick={() => update({ enabled: !settings.enabled })}
            className="relative w-11 h-6 rounded-full transition-colors"
            style={{ background: settings.enabled ? 'var(--accent)' : 'var(--bg-inset)' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
              style={{
                background: 'white',
                transform: settings.enabled ? 'translateX(20px)' : 'translateX(0)',
              }}
            />
          </button>
        </div>

        {settings.enabled && (
          <div className="space-y-4 p-4 rounded-lg" style={{ border: '1px solid var(--border)' }}>
            {/* Provider */}
            <div>
              <label className="block text-sm font-medium mb-2">Provider</label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    className="py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: settings.provider === p ? 'var(--accent)' : 'var(--bg-inset)',
                      color: settings.provider === p ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {PROVIDER_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {/* ManDao built-in info */}
            {!needsKey && (
              <div className="p-3 rounded-lg text-sm space-y-1" style={{ background: 'var(--bg-inset)' }}>
                <p style={{ color: 'var(--text-primary)' }}>
                  No setup needed — works out of the box.
                </p>
                <p style={{ color: 'var(--text-tertiary)' }}>
                  Uses GPT-4o-mini via ManDao's server. Limited to 20 requests/day.
                  For unlimited use, select a provider above and use your own API key.
                </p>
              </div>
            )}

            {/* API Key (BYOK providers only) */}
            {needsKey && (
              <div>
                <label className="block text-sm font-medium mb-1">API Key</label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    onChange={(e) => { update({ apiKey: e.target.value }); setTestResult(null); }}
                    placeholder={`Paste your ${PROVIDER_LABELS[settings.provider]} API key`}
                    className="flex-1 px-3 py-2 rounded-lg text-sm"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="px-3 py-2 rounded-lg text-sm transition-colors"
                    style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Your key is stored in browser local storage and sent only to the {PROVIDER_LABELS[settings.provider]} API. It never touches our servers.
                </p>
                {settings.provider === 'gemini' && (
                  <p className="mt-1 text-xs p-2 rounded" style={{ background: 'var(--warning-subtle, var(--bg-inset))', color: 'var(--warning, var(--text-secondary))' }}>
                    Gemini's API sends your key as a URL parameter. This means it may appear in browser history and network logs. Use a restricted key with only the Generative Language API enabled.
                  </p>
                )}
              </div>
            )}

            {/* Model (BYOK only — ManDao uses a fixed model) */}
            {needsKey && (
              <div>
                <label className="block text-sm font-medium mb-1">Model</label>
                <input
                  type="text"
                  value={settings.model}
                  onChange={(e) => update({ model: e.target.value })}
                  placeholder={DEFAULT_MODELS[settings.provider]}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Leave blank for default: {DEFAULT_MODELS[settings.provider]}
                </p>
              </div>
            )}

            {/* Custom Endpoint (BYOK only) */}
            {needsKey && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Advanced: Custom endpoint
                </summary>
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={settings.endpointUrl}
                    onChange={(e) => update({ endpointUrl: e.target.value })}
                    placeholder="Leave blank for default"
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                  {settings.endpointUrl && (
                    <p className="text-xs p-2 rounded" style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
                      Your API key and prompts will be sent to this custom URL. Only use endpoints you trust.
                    </p>
                  )}
                </div>
              </details>
            )}

            {/* Test Connection */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing || (needsKey && !settings.apiKey)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult && (
                <span className="text-sm" style={{ color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {testResult.message}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Security info */}
        <div className="p-3 rounded-lg text-xs space-y-1" style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}>
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Security notes</p>
          {needsKey ? (
            <>
              <p>Your API key is stored in this browser only. It does not sync across devices — you'll need to re-enter it on each browser you use.</p>
              <p>Your key is sent only to your chosen provider's API endpoint and never touches our servers.</p>
              <p>For best security: use API keys with spending limits, and rotate them periodically.</p>
            </>
          ) : (
            <>
              <p>The built-in provider routes requests through ManDao's server. Your sentences are sent to our server and forwarded to the AI model.</p>
              <p>No API key is needed — usage is rate-limited to 20 requests/day.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
