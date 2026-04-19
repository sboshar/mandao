import { useState, useEffect, useCallback, useRef } from 'react';
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
import { isAIConfigured } from '../services/aiProvider';
import { downloadAnkiExport } from '../services/ankiExport';
import { importFromAnki, type ImportProgress } from '../services/ankiImport';
import { importFromApkg, downloadApkgExport, analyzeApkg, type ApkgFieldInfo } from '../services/ankiApkg';
import * as repo from '../db/repo';
import type { Deck } from '../db/schema';
import { localDb } from '../db/localDb';

type Section = 'account' | 'srs' | 'display' | 'ai' | 'anki' | 'data';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'srs', label: 'SRS' },
  { id: 'display', label: 'Display' },
  { id: 'ai', label: 'AI' },
  { id: 'anki', label: 'Anki' },
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
      {section === 'anki' && <AnkiSection />}
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
  const [stepsError, setStepsError] = useState<string | null>(null);

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

  const STEP_PATTERN = /^\d+(m|h|d)$/;

  const parseSteps = (str: string): string[] | null => {
    const parts = str.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.every((p) => STEP_PATTERN.test(p))) return parts;
    return null;
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
                if (steps) { fsrsUpdate({ learningSteps: steps }); setStepsError(null); }
                else { setStepsError('Invalid format. Use values like 1m, 10m, 1h, 1d.'); setLearningStepsStr(fsrs.learningSteps.join(', ')); }
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
                if (steps) { fsrsUpdate({ relearningSteps: steps }); setStepsError(null); }
                else { setStepsError('Invalid format. Use values like 1m, 10m, 1h, 1d.'); setRelearningStepsStr(fsrs.relearningSteps.join(', ')); }
              }}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Comma-separated intervals for lapsed cards. Default: 10m.
            </p>
          </div>

          {stepsError && (
            <p className="text-xs" style={{ color: 'var(--danger, #e53e3e)' }}>{stepsError}</p>
          )}

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

function AnkiSection() {
  const [ankiExporting, setAnkiExporting] = useState(false);
  const [ankiExportResult, setAnkiExportResult] = useState<string | null>(null);
  const [ankiImporting, setAnkiImporting] = useState(false);
  const [ankiProgress, setAnkiProgress] = useState<ImportProgress | null>(null);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [apkgInfo, setApkgInfo] = useState<ApkgFieldInfo | null>(null);
  const [apkgFile, setApkgFile] = useState<File | null>(null);
  const [apkgAnalyzing, setApkgAnalyzing] = useState(false);
  const [chineseField, setChineseField] = useState(0);
  const [displayField, setDisplayField] = useState(0);
  const [audioField, setAudioField] = useState<number | null>(null);
  const [audioName, setAudioName] = useState('anki');
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());
  const lastClickedIdx = useRef<number | null>(null);
  const dragSelectMode = useRef<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aiEnabled = isAIConfigured();

  // Reset stale drag mode if mouse released anywhere
  useEffect(() => {
    const handler = () => { dragSelectMode.current = null; };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, []);

  const handleAnkiExport = async (format: 'text' | 'apkg') => {
    setAnkiExporting(true);
    setAnkiExportResult(null);
    setAnkiError(null);
    try {
      if (format === 'apkg') {
        const count = await downloadApkgExport();
        setAnkiExportResult(`Exported ${count} sentence${count !== 1 ? 's' : ''} as .apkg file.`);
      } else {
        const count = await downloadAnkiExport();
        setAnkiExportResult(`Exported ${count} sentence${count !== 1 ? 's' : ''} to Anki text format.`);
      }
    } catch (e: any) {
      setAnkiError(e.message || 'Export failed');
    }
    setAnkiExporting(false);
  };

  const handleFileSelected = async (file: File) => {
    if (file.name.toLowerCase().endsWith('.apkg')) {
      setApkgAnalyzing(true);
      setAnkiError(null);
      try {
        const info = await analyzeApkg(file);
        setApkgInfo(info);
        setApkgFile(file);
        setChineseField(info.suggestedChineseField);
        const otherField = info.fieldNames.findIndex((_, i) => i !== info.suggestedChineseField);
        setDisplayField(otherField >= 0 ? otherField : 0);
        setAudioField(null);
        setAudioName('anki');
        setSelectedNotes(new Set(info.notes.map(n => n.id)));
      } catch (e: any) {
        setAnkiError(e.message || 'Failed to read .apkg file');
      }
      setApkgAnalyzing(false);
    } else {
      await runImport(() => importFromAnki(file, (p) => setAnkiProgress({ ...p }), abortRef.current!.signal));
    }
  };

  const startApkgImport = async () => {
    if (!apkgFile) return;
    const noteIds = new Set(selectedNotes);
    const file = apkgFile;
    const chIdx = chineseField;
    const audioIdx = audioField;
    const audioLabel = audioName;
    setApkgInfo(null);
    setApkgFile(null);
    await runImport(() => importFromApkg(
      file,
      (p) => setAnkiProgress({ ...p }),
      abortRef.current!.signal,
      chIdx,
      noteIds,
      audioIdx,
      audioLabel,
    ));
  };

  const runImport = async (importFn: () => Promise<ImportProgress>) => {
    setAnkiImporting(true);
    setAnkiError(null);
    setAnkiProgress(null);
    abortRef.current = new AbortController();
    try {
      const result = await importFn();
      setAnkiProgress(result);
    } catch (e: any) {
      setAnkiError(e.message || 'Import failed');
    }
    setAnkiImporting(false);
    abortRef.current = null;
  };

  const handleAbort = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-5">
      {/* Export to Anki */}
      <SectionCard
        title="Export to Anki"
        description="Download all sentences in a format Anki can import."
      >
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleAnkiExport('apkg')}
            disabled={ankiExporting}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            {ankiExporting ? 'Exporting...' : 'Export as .apkg'}
          </button>
          <button
            onClick={() => handleAnkiExport('text')}
            disabled={ankiExporting}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            {ankiExporting ? 'Exporting...' : 'Export as Text'}
          </button>
          {ankiExportResult && (
            <p className="w-full mt-1 text-sm" style={{ color: 'var(--success)' }}>{ankiExportResult}</p>
          )}
          {ankiError && !ankiImporting && (
            <p className="w-full mt-1 text-sm" style={{ color: 'var(--danger)' }}>{ankiError}</p>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          .apkg files can be imported directly into Anki with File &gt; Import.
          Text export uses tab-separated format with FSRS scheduling data.
        </p>
      </SectionCard>

      {/* Import from Anki */}
      <SectionCard
        title="Import from Anki"
        description="Upload an .apkg or text file exported from Anki. For .apkg files, choose which field contains the Chinese sentence to import (Import field), and which field to browse by (Display as) — e.g. switch to English to find sentences by meaning. The AI will then analyze each selected sentence to generate pinyin, tokenization, and word breakdowns."
      >
        {!aiEnabled && (
          <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
            AI must be configured to import from Anki. The AI is used to detect column mappings and
            analyze each sentence for tokenization and pinyin.
            Go to the <strong>AI</strong> tab to set up a provider.
          </div>
        )}

        {aiEnabled && !ankiImporting && !ankiProgress && !apkgInfo && (
          <div>
            <label
              className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              style={{
                background: apkgAnalyzing ? 'var(--bg-inset)' : 'var(--accent)',
                color: apkgAnalyzing ? 'var(--text-tertiary)' : 'var(--text-inverted)',
                pointerEvents: apkgAnalyzing ? 'none' : undefined,
              }}
            >
              {apkgAnalyzing ? 'Reading file...' : 'Choose Anki File'}
              <input
                type="file"
                accept=".txt,.csv,.tsv,.apkg"
                className="hidden"
                disabled={apkgAnalyzing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Accepts .apkg, .txt, .csv, or .tsv files. In Anki, use File &gt; Export to create a file.
            </p>
          </div>
        )}

        {/* .apkg browse & select */}
        {apkgInfo && !ankiImporting && !ankiProgress && (
          <div className="space-y-4">
            {/* Primary: Import field + Audio field */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Import field (Chinese)</label>
                <select
                  value={chineseField}
                  onChange={(e) => setChineseField(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--bg-inset)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  {apkgInfo.fieldNames.map((name, idx) => (
                    <option key={idx} value={idx}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Audio field</label>
                <select
                  value={audioField === null ? '' : audioField}
                  onChange={(e) => setAudioField(e.target.value === '' ? null : Number(e.target.value))}
                  disabled={!apkgInfo.hasAudio}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-50"
                  style={{ background: 'var(--bg-inset)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="">{apkgInfo.hasAudio ? 'None (skip audio)' : 'No audio in deck'}</option>
                  {apkgInfo.fieldNames.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name}{idx === apkgInfo.suggestedAudioField ? ' (detected)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Audio name (only meaningful when audio is enabled) */}
            {apkgInfo.hasAudio && audioField !== null && (
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Audio name</label>
                <input
                  type="text"
                  value={audioName}
                  onChange={(e) => setAudioName(e.target.value)}
                  placeholder="anki"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--bg-inset)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            )}

            {/* Select all / none */}
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {selectedNotes.size} of {apkgInfo.notes.length} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedNotes(new Set(apkgInfo.notes.map(n => n.id)))}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ color: 'var(--accent)' }}
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedNotes(new Set())}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Select none
                </button>
              </div>
            </div>

            {/* Secondary: Display-as (how the note list previews each note) */}
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span>Display notes as</span>
              <select
                value={displayField}
                onChange={(e) => setDisplayField(Number(e.target.value))}
                className="px-2 py-1 rounded outline-none bg-transparent"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                {apkgInfo.fieldNames.map((name, idx) => (
                  <option key={idx} value={idx}>{name}</option>
                ))}
              </select>
            </div>

            {/* Note list — shift-click for range, drag to paint-select */}
            <div
              className="rounded-lg overflow-y-auto select-none"
              style={{ maxHeight: 400, border: '1px solid var(--border)' }}
              onMouseLeave={() => { dragSelectMode.current = null; }}
              onMouseUp={() => { dragSelectMode.current = null; }}
            >
              {apkgInfo.notes.map((note, idx) => {
                const display = note.fields[displayField] ?? '';
                const isSelected = selectedNotes.has(note.id);

                return (
                  <div
                    key={note.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                    style={{
                      background: isSelected ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (e.shiftKey && lastClickedIdx.current !== null) {
                        // Shift-click: select range
                        const from = Math.min(lastClickedIdx.current, idx);
                        const to = Math.max(lastClickedIdx.current, idx);
                        setSelectedNotes(prev => {
                          const next = new Set(prev);
                          for (let j = from; j <= to; j++) {
                            next.add(apkgInfo.notes[j].id);
                          }
                          return next;
                        });
                      } else {
                        // Toggle and start drag
                        const willSelect = !isSelected;
                        dragSelectMode.current = willSelect;
                        setSelectedNotes(prev => {
                          const next = new Set(prev);
                          if (willSelect) next.add(note.id);
                          else next.delete(note.id);
                          return next;
                        });
                      }
                      lastClickedIdx.current = idx;
                    }}
                    onMouseEnter={() => {
                      if (dragSelectMode.current === null) return;
                      setSelectedNotes(prev => {
                        const next = new Set(prev);
                        if (dragSelectMode.current) next.add(note.id);
                        else next.delete(note.id);
                        return next;
                      });
                    }}
                  >
                    <div
                      className="shrink-0 w-4 h-4 rounded border flex items-center justify-center"
                      style={{
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        background: isSelected ? 'var(--accent)' : 'transparent',
                      }}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {display || <span style={{ color: 'var(--text-tertiary)' }}>(empty)</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Click to toggle. Shift-click for range. Drag to select multiple.
            </p>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={startApkgImport}
                disabled={selectedNotes.size === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
              >
                Import {selectedNotes.size} sentence{selectedNotes.size !== 1 ? 's' : ''}
              </button>
              <button
                onClick={() => setApkgInfo(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Progress indicator */}
        {ankiImporting && ankiProgress && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Processing {ankiProgress.processed} / {ankiProgress.total}
              </span>
              <button
                onClick={handleAbort}
                className="px-3 py-1 rounded text-xs font-medium transition-colors"
                style={{ background: 'var(--bg-inset)', color: 'var(--danger)' }}
              >
                Stop
              </button>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-inset)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${ankiProgress.total > 0 ? (ankiProgress.processed / ankiProgress.total) * 100 : 0}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <span className="font-medium" style={{ color: 'var(--success)' }}>{ankiProgress.imported}</span>
                <span style={{ color: 'var(--text-tertiary)' }}> imported</span>
              </div>
              <div>
                <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{ankiProgress.skipped}</span>
                <span style={{ color: 'var(--text-tertiary)' }}> skipped</span>
              </div>
              <div>
                <span className="font-medium" style={{ color: 'var(--danger)' }}>{ankiProgress.failed}</span>
                <span style={{ color: 'var(--text-tertiary)' }}> failed</span>
              </div>
            </div>

            {ankiProgress.currentSentence && (
              <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                {ankiProgress.currentSentence}
              </p>
            )}
          </div>
        )}

        {/* Summary after completion */}
        {!ankiImporting && ankiProgress && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg" style={{ background: 'var(--bg-inset)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Import complete
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--success)' }}>{ankiProgress.imported}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>imported</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--text-secondary)' }}>{ankiProgress.skipped}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>skipped</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--danger)' }}>{ankiProgress.failed}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>failed</div>
                </div>
              </div>

              {ankiProgress.issues && ankiProgress.issues.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                    {ankiProgress.skipped + ankiProgress.failed} skipped/failed — tap to see details
                  </summary>
                  <div className="mt-2 rounded-lg overflow-y-auto" style={{ maxHeight: 250, border: '1px solid var(--border)' }}>
                    {ankiProgress.issues.map((issue, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 text-xs"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              background: issue.type === 'failed'
                                ? 'color-mix(in srgb, var(--danger) 15%, var(--bg-surface))'
                                : 'color-mix(in srgb, var(--text-secondary) 10%, var(--bg-surface))',
                              color: issue.type === 'failed' ? 'var(--danger)' : 'var(--text-secondary)',
                            }}
                          >
                            {issue.type}
                          </span>
                          <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {issue.sentence}
                          </span>
                        </div>
                        <div className="mt-0.5 pl-[52px]" style={{ color: 'var(--text-tertiary)' }}>
                          {issue.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <button
              onClick={() => { setAnkiProgress(null); setAnkiError(null); }}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
            >
              Import Another File
            </button>
          </div>
        )}

        {ankiError && ankiImporting && (
          <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>{ankiError}</p>
        )}
      </SectionCard>
    </div>
  );
}

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
