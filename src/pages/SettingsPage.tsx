import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  useAISettingsStore,
  PROVIDER_LABELS,
  MODEL_OPTIONS,
  type AIProvider,
} from '../stores/aiSettingsStore';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { useFSRSSettingsStore } from '../stores/fsrsSettingsStore';
import { generateCompletion } from '../services/aiProvider';
import * as repo from '../db/repo';
import type { Deck } from '../db/schema';
import { localDb } from '../db/localDb';

type Section = 'account' | 'srs' | 'display' | 'ai' | 'data';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'srs', label: 'SRS' },
  { id: 'display', label: 'Display' },
  { id: 'ai', label: 'AI' },
  { id: 'data', label: 'Data' },
];

const PROVIDERS: AIProvider[] = ['gemini', 'openai', 'anthropic'];

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>('account');

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      {/* Header */}
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

      {/* Section tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-lg overflow-x-auto"
        style={{ background: 'var(--bg-inset)' }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className="flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
            style={{
              background: section === s.id ? 'var(--bg-surface)' : 'transparent',
              color: section === s.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: section === s.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      {section === 'account' && <AccountSection />}
      {section === 'srs' && <SRSSection />}
      {section === 'display' && <DisplaySection />}
      {section === 'ai' && <AISection />}
      {section === 'data' && <DataSection />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Shared UI
// ────────────────────────────────────────────────────────────

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-lg space-y-4" style={{ border: '1px solid var(--border)' }}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 1, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full px-3 py-2 rounded-lg text-sm"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      />
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-11 h-6 rounded-full transition-colors shrink-0"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-inset)' }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
        style={{
          background: 'white',
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Account
// ────────────────────────────────────────────────────────────

function AccountSection() {
  const { user, signOut } = useAuthStore();

  return (
    <div className="space-y-5">
      <SectionCard title="Profile">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Email
            </label>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {user?.email ?? 'Unknown'}
            </p>
          </div>
          {user?.app_metadata?.provider && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Sign-in method
              </label>
              <p className="text-sm capitalize" style={{ color: 'var(--text-primary)' }}>
                {user.app_metadata.provider}
              </p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Member since
            </label>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
            </p>
          </div>
        </div>
      </SectionCard>

      <button
        onClick={signOut}
        className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-inset)', color: 'var(--danger, #e53e3e)' }}
      >
        Sign out
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SRS (Deck limits + FSRS algorithm params)
// ────────────────────────────────────────────────────────────

function SRSSection() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const fsrs = useFSRSSettingsStore();
  const fsrsUpdate = useFSRSSettingsStore((s) => s.update);
  const fsrsReset = useFSRSSettingsStore((s) => s.reset);
  const [learningStepsStr, setLearningStepsStr] = useState(fsrs.learningSteps.join(', '));
  const [relearningStepsStr, setRelearningStepsStr] = useState(fsrs.relearningSteps.join(', '));

  useEffect(() => {
    (async () => {
      const deckId = await repo.ensureDefaultDeck();
      const d = await repo.getDeck(deckId);
      setDeck(d ?? null);
      setLoading(false);
    })();
  }, []);

  const updateDeckField = useCallback(async (field: keyof Deck, value: number) => {
    if (!deck) return;
    await repo.updateDeck(deck.id, { [field]: value });
    setDeck({ ...deck, [field]: value });
  }, [deck]);

  const parseSteps = (str: string): string[] => {
    return str.split(',').map((s) => s.trim()).filter(Boolean);
  };

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>;
  }

  return (
    <div className="space-y-5">
      {/* Daily limits */}
      <SectionCard title="Daily Limits" description="Control how many cards you see each day.">
        <div className="grid grid-cols-2 gap-4">
          <NumberInput
            label="New cards / day"
            value={deck?.newCardsPerDay ?? 20}
            onChange={(v) => updateDeckField('newCardsPerDay', Math.max(0, v))}
            min={0}
            max={9999}
            hint="New cards introduced per day"
          />
          <NumberInput
            label="Reviews / day"
            value={deck?.reviewsPerDay ?? 200}
            onChange={(v) => updateDeckField('reviewsPerDay', Math.max(0, v))}
            min={0}
            max={9999}
            hint="Maximum reviews per day"
          />
        </div>
      </SectionCard>

      {/* FSRS parameters */}
      <SectionCard title="FSRS Algorithm" description="Tune the Free Spaced Repetition Scheduler. Changes apply to future reviews.">
        <div className="space-y-4">
          <NumberInput
            label="Desired retention"
            value={fsrs.requestRetention}
            onChange={(v) => fsrsUpdate({ requestRetention: Math.min(0.99, Math.max(0.7, v)) })}
            min={0.7}
            max={0.99}
            step={0.01}
            hint="Target recall probability (0.70 - 0.99). Higher = more frequent reviews."
          />
          <NumberInput
            label="Maximum interval (days)"
            value={fsrs.maximumInterval}
            onChange={(v) => fsrsUpdate({ maximumInterval: Math.max(1, Math.round(v)) })}
            min={1}
            max={36500}
            hint="Longest gap between reviews. Default: 36500 (~100 years)."
          />

          {/* Learning steps */}
          <div>
            <label className="block text-sm font-medium mb-1">Learning steps</label>
            <input
              type="text"
              value={learningStepsStr}
              onChange={(e) => setLearningStepsStr(e.target.value)}
              onBlur={() => {
                const steps = parseSteps(learningStepsStr);
                if (steps.length > 0) fsrsUpdate({ learningSteps: steps });
              }}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Comma-separated intervals for new cards (e.g. 1m, 10m, 1h, 1d). Default: 1m, 10m.
            </p>
          </div>

          {/* Relearning steps */}
          <div>
            <label className="block text-sm font-medium mb-1">Relearning steps</label>
            <input
              type="text"
              value={relearningStepsStr}
              onChange={(e) => setRelearningStepsStr(e.target.value)}
              onBlur={() => {
                const steps = parseSteps(relearningStepsStr);
                if (steps.length > 0) fsrsUpdate({ relearningSteps: steps });
              }}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Comma-separated intervals for lapsed cards. Default: 10m.
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable fuzz</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Add small random variation to review intervals to avoid clustering.
                </p>
              </div>
              <Toggle checked={fsrs.enableFuzz} onChange={(v) => fsrsUpdate({ enableFuzz: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Short-term scheduling</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Use learning/relearning steps. Disable to skip straight to long-term scheduling.
                </p>
              </div>
              <Toggle checked={fsrs.enableShortTerm} onChange={(v) => fsrsUpdate({ enableShortTerm: v })} />
            </div>
          </div>

          <button
            onClick={fsrsReset}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            Reset to defaults
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Display
// ────────────────────────────────────────────────────────────

function DisplaySection() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="space-y-5">
      <SectionCard title="Appearance">
        <div>
          <label className="block text-sm font-medium mb-2">Theme</label>
          <div className="flex gap-2">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className="flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors"
                style={{
                  background: theme === t ? 'var(--accent)' : 'var(--bg-inset)',
                  color: theme === t ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// AI Configuration (preserved from original)
// ────────────────────────────────────────────────────────────

function AISection() {
  const settings = useAISettingsStore();
  const update = useAISettingsStore((s) => s.update);

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    <div className="space-y-5">
      <SectionCard title="AI-Powered Analysis" description="Automatically analyze sentences instead of copy-pasting to an LLM.">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Enable AI analysis</p>
          <Toggle checked={settings.enabled} onChange={(v) => update({ enabled: v })} />
        </div>

        {settings.enabled && (
          <div className="space-y-4">
            {/* Provider */}
            <div>
              <label className="block text-sm font-medium mb-2">Provider</label>
              <div className="flex gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
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

            {/* Gemini setup guide */}
            {settings.provider === 'gemini' && !settings.apiKey && (
              <div className="p-3 rounded-lg text-sm space-y-2" style={{ background: 'var(--bg-inset)' }}>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  Recommended: Gemini is completely free
                </p>
                <ol className="list-decimal list-inside space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <li>
                    Go to{' '}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium"
                      style={{ color: 'var(--accent)' }}
                    >
                      Google AI Studio
                    </a>
                  </li>
                  <li>Click "Create API Key"</li>
                  <li>Copy the key and paste it below</li>
                </ol>
                <p style={{ color: 'var(--text-tertiary)' }}>
                  No credit card required. Free tier includes up to 500 requests/day.
                </p>
              </div>
            )}

            {/* API Key */}
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
              {settings.provider === 'gemini' && settings.apiKey && (
                <p className="mt-1 text-xs p-2 rounded" style={{ background: 'var(--warning-subtle, var(--bg-inset))', color: 'var(--warning, var(--text-secondary))' }}>
                  Gemini's API sends your key as a URL parameter. This means it may appear in browser history and network logs. Use a restricted key with only the Generative Language API enabled.
                </p>
              )}
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              {(() => {
                const options = MODEL_OPTIONS[settings.provider];
                const isCustom = settings.model && !options.some((o) => o.id === settings.model);
                const selectValue = isCustom ? '__custom__' : (settings.model || options[0].id);
                return (
                  <div className="space-y-2">
                    <select
                      value={selectValue}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          update({ model: '__custom__' });
                        } else {
                          update({ model: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    >
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                      <option value="__custom__">Custom model...</option>
                    </select>
                    {isCustom && (
                      <input
                        type="text"
                        value={settings.model === '__custom__' ? '' : settings.model}
                        onChange={(e) => update({ model: e.target.value || '__custom__' })}
                        placeholder="Enter model ID"
                        autoFocus
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Test Connection */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing || !settings.apiKey}
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
      </SectionCard>

      {/* Security info */}
      <div className="p-3 rounded-lg text-xs space-y-1" style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}>
        <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Security notes</p>
        <p>Your API key is stored in this browser only. It does not sync across devices — you'll need to re-enter it on each browser you use.</p>
        <p>Your key is sent only to your chosen provider's API endpoint and never touches our servers.</p>
        <p>For best security: use API keys with spending limits, and rotate them periodically.</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Data Management
// ────────────────────────────────────────────────────────────

function DataSection() {
  const { signOut } = useAuthStore();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const [meanings, meaningLinks, sentences, sentenceTokens, srsCards, decks, reviewLogs] =
        await Promise.all([
          localDb.meanings.toArray(),
          localDb.meaningLinks.toArray(),
          localDb.sentences.toArray(),
          localDb.sentenceTokens.toArray(),
          localDb.srsCards.toArray(),
          localDb.decks.toArray(),
          localDb.reviewLogs.toArray(),
        ]);

      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        meanings,
        meaningLinks,
        sentences,
        sentenceTokens,
        srsCards,
        decks,
        reviewLogs,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mandao-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Export failed:', e);
    }
    setExporting(false);
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version || !data.sentences) {
        throw new Error('Invalid export file format');
      }

      await localDb.transaction(
        'rw',
        [localDb.meanings, localDb.meaningLinks, localDb.sentences, localDb.sentenceTokens, localDb.srsCards, localDb.decks, localDb.reviewLogs],
        async () => {
          if (data.meanings?.length) await localDb.meanings.bulkPut(data.meanings);
          if (data.meaningLinks?.length) await localDb.meaningLinks.bulkPut(data.meaningLinks);
          if (data.sentences?.length) await localDb.sentences.bulkPut(data.sentences);
          if (data.sentenceTokens?.length) await localDb.sentenceTokens.bulkPut(data.sentenceTokens);
          if (data.srsCards?.length) await localDb.srsCards.bulkPut(data.srsCards);
          if (data.decks?.length) await localDb.decks.bulkPut(data.decks);
          if (data.reviewLogs?.length) await localDb.reviewLogs.bulkPut(data.reviewLogs);
        }
      );
    } catch (e: any) {
      setImportError(e.message || 'Import failed');
    }
    setImporting(false);
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      await repo.deleteAllUserData();
      await signOut();
    } catch (e: any) {
      console.error('Delete failed:', e);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Export */}
      <SectionCard title="Export Data" description="Download all your data as a JSON file.">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
        >
          {exporting ? 'Exporting...' : 'Export All Data'}
        </button>
      </SectionCard>

      {/* Import */}
      <SectionCard title="Import Data" description="Restore data from a previous export. Existing data will be merged.">
        <div>
          <label
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            {importing ? 'Importing...' : 'Choose File'}
            <input
              type="file"
              accept=".json"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
          </label>
          {importError && (
            <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>{importError}</p>
          )}
        </div>
      </SectionCard>

      {/* Delete account / data */}
      <SectionCard title="Danger Zone" description="Permanently delete all your data. This cannot be undone.">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--danger, #e53e3e)', color: '#fff' }}
          >
            Delete All Data
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--danger, #e53e3e)' }}>
              Are you sure? This will permanently delete all sentences, cards, and review history from both this device and the server.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--danger, #e53e3e)', color: '#fff' }}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete Everything'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-lg text-sm transition-colors"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
