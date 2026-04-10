import { useState, useEffect, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ingestSentence, type TokenInput, type CharacterInput } from '../services/ingestion';
import {
  generateAnalysisPrompt,
  parseLLMResponse,
  getExistingMeaningsForSegments,
} from '../services/llmPrompt';
import { tokenizeSentence } from '../services/tokenizer';
import { loadCedict, isLoaded as cedictLoaded } from '../lib/cedict';
import { numericStringToDiacritic } from '../services/toneSandhi';
import { PinyinIMEInput } from '../components/PinyinIMEInput';
import { TutorialBanner } from '../components/TutorialBanner';
import { TagInput } from '../components/TagInput';
import { useTutorialStore } from '../stores/tutorialStore';
import { useSyncStore } from '../stores/syncStore';
import { TUTORIAL_SENTENCES } from '../data/tutorialSentences';

interface TokenFormData {
  surfaceForm: string;
  pinyinNumeric: string;
  pinyinSandhi: string;
  english: string;
  partOfSpeech: string;
  characters?: CharacterInput[];
}

export function AddSentencePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isTutorial = searchParams.get('tutorial') === '1';
  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);

  const [chinese, setChinese] = useState('');
  const [english, setEnglish] = useState('');
  const [segments, setSegments] = useState<string[]>([]);
  const [tokens, setTokens] = useState<TokenFormData[]>([]);
  const [step, setStep] = useState<'input' | 'segment' | 'review' | 'confirm'>('input');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dictLoading, setDictLoading] = useState(false);
  const [llmPasteValue, setLlmPasteValue] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [usePinyinIME, setUsePinyinIME] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  // Load dictionary on mount
  useEffect(() => {
    if (!cedictLoaded()) {
      setDictLoading(true);
      loadCedict().then(() => setDictLoading(false));
    }
  }, []);

  // Tutorial mode: pre-fill Chinese sentence
  useEffect(() => {
    if (isTutorial && tutorialStep === 1 && step === 'input') {
      setChinese(TUTORIAL_SENTENCES[0].chinese);
    }
  }, [isTutorial, tutorialStep, step]);

  // Step 1 → Step 2: Auto-segment with CC-CEDICT
  const handleSegment = () => {
    if (!chinese.trim()) {
      setError('Please enter a Chinese sentence.');
      return;
    }
    setError('');
    const rawTokens = tokenizeSentence(chinese.trim());
    const segs = rawTokens
      .map((t) => t.text)
      .filter((t) => t.trim().length > 0 && !/^[。，！？；：、《》（）""''…·\s]$/.test(t));
    setSegments(segs);
    setStep('segment');
  };

  // Segment editing
  const handleSplitSegment = (index: number) => {
    const seg = segments[index];
    if (seg.length <= 1) return;
    const chars = Array.from(seg);
    const newSegs = [...segments];
    newSegs.splice(index, 1, ...chars);
    setSegments(newSegs);
  };

  const handleMergeSegments = (index: number) => {
    if (index >= segments.length - 1) return;
    const newSegs = [...segments];
    const merged = newSegs[index] + newSegs[index + 1];
    newSegs.splice(index, 2, merged);
    setSegments(newSegs);
  };

  // Copy LLM prompt with segments
  const handleCopyPrompt = async () => {
    setError('');
    const existingMeanings = await getExistingMeaningsForSegments(segments);
    const prompt = generateAnalysisPrompt(chinese.trim(), segments, existingMeanings);
    await navigator.clipboard.writeText(prompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  // Parse LLM JSON response
  const handleParseLLMResponse = () => {
    try {
      const parsed = parseLLMResponse(llmPasteValue);
      if (parsed.english) setEnglish(parsed.english);

      const formTokens: TokenFormData[] = parsed.tokens.map((t) => ({
        surfaceForm: t.surfaceForm,
        pinyinNumeric: t.pinyinNumeric,
        pinyinSandhi: t.pinyinSandhi || '',
        english: t.english,
        partOfSpeech: t.partOfSpeech || '',
        characters: t.characters?.map((c) => ({
          char: c.char,
          pinyinNumeric: c.pinyinNumeric,
          pinyinSandhi: c.pinyinSandhi,
          english: c.english,
        })),
      }));

      setTokens(formTokens);
      setLlmPasteValue('');
      setStep('review');
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Tutorial mode: skip LLM step, use pre-built token data
  const handleTutorialSkipLLM = () => {
    const tutorialTokens = TUTORIAL_SENTENCES[0].tokens;
    setEnglish(TUTORIAL_SENTENCES[0].english);
    const formTokens: TokenFormData[] = tutorialTokens.map((t) => ({
      surfaceForm: t.surfaceForm,
      pinyinNumeric: t.pinyinNumeric,
      pinyinSandhi: '',
      english: t.english,
      partOfSpeech: t.partOfSpeech || '',
      characters: t.characters?.map((c) => ({
        char: c.char,
        pinyinNumeric: c.pinyinNumeric,
        pinyinSandhi: c.pinyinSandhi,
        english: c.english,
      })),
    }));
    setTokens(formTokens);
    setStep('review');
  };

  // Token editing (in review step)
  const updateToken = (index: number, field: keyof TokenFormData, value: string) => {
    const newTokens = [...tokens];
    newTokens[index] = { ...newTokens[index], [field]: value };
    setTokens(newTokens);
  };

  const updateCharacter = (tokenIndex: number, charIndex: number, field: string, value: string) => {
    const newTokens = [...tokens];
    const token = { ...newTokens[tokenIndex] };
    if (!token.characters) return;
    const newChars = [...token.characters];
    newChars[charIndex] = { ...newChars[charIndex], [field]: value };
    token.characters = newChars;
    newTokens[tokenIndex] = token;
    setTokens(newTokens);
  };

  const handleConfirm = () => {
    if (!english.trim()) {
      setError('Please provide an English translation for the sentence.');
      return;
    }
    for (const t of tokens) {
      if (!t.pinyinNumeric || !t.english) {
        setError('Please fill in pinyin and English for all tokens.');
        return;
      }
    }
    setError('');
    setStep('confirm');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    if (navigator.onLine) useSyncStore.getState().setStatus('syncing');
    try {
      const tokenInputs: TokenInput[] = tokens.map((t) => ({
        surfaceForm: t.surfaceForm,
        pinyinNumeric: t.pinyinNumeric,
        english: t.english,
        partOfSpeech: t.partOfSpeech || 'other',
        characters: t.characters,
      }));

      try {
        await ingestSentence({
          chinese: chinese.trim(),
          english: english.trim(),
          tokens: tokenInputs,
          tags,
        });
      } catch (e: any) {
        // In tutorial mode, skip duplicate errors so re-running works
        if (!(isTutorial && e.message?.includes('already exists'))) {
          throw e;
        }
      }

      // Tutorial mode: seed remaining sentences in the background, then advance
      if (isTutorial && tutorialStep === 1) {
        // Seed remaining 2 sentences silently
        for (let i = 1; i < TUTORIAL_SENTENCES.length; i++) {
          try {
            await ingestSentence(TUTORIAL_SENTENCES[i]);
          } catch {
            // skip duplicates
          }
        }
        advanceTutorial(); // step 1 → 2
        navigate('/');
      } else {
        setChinese('');
        setEnglish('');
        setSegments([]);
        setTokens([]);
        setTags([]);
        setStep('input');
        navigate('/');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save sentence.');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Add Sentence</h1>
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded text-sm transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          &larr; Back
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded text-sm whitespace-pre-wrap"
          style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Step 1: Enter Chinese sentence */}
      {step === 'input' && (
        <div className="space-y-4">
          {isTutorial && (
            <TutorialBanner visibleAt={1}>
              This is where you add sentences. We've pre-filled the first example for you.
              Click <strong>Next: Segment Words</strong> to see how the app breaks it into tokens.
            </TutorialBanner>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">
                Chinese Sentence
              </label>
              {!(isTutorial && tutorialStep === 1) && (
                <button
                  type="button"
                  onClick={() => setUsePinyinIME(!usePinyinIME)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                    usePinyinIME
                      ? 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {usePinyinIME ? '拼 Pinyin ON' : '拼 Pinyin OFF'}
                </button>
              )}
            </div>
            {usePinyinIME && !(isTutorial && tutorialStep === 1) ? (
              <PinyinIMEInput
                value={chinese}
                onChange={setChinese}
                placeholder="Type pinyin, e.g. nihao"
              />
            ) : (
              <input
                type="text"
                value={chinese}
                onChange={(e) => setChinese(e.target.value)}
                placeholder="他差不多吃完了。"
                className="w-full px-3 py-2 rounded-lg focus:ring-2 text-lg"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                lang="zh"
                readOnly={isTutorial && tutorialStep === 1}
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
          <button
            onClick={handleSegment}
            disabled={dictLoading || !chinese.trim()}
            className={`w-full py-3 rounded-lg font-medium disabled:opacity-50 transition-colors ${
              isTutorial && tutorialStep === 1 ? 'ring-2 ring-offset-2' : ''
            }`}
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            {dictLoading ? 'Loading dictionary...' : 'Next: Segment Words'}
          </button>
        </div>
      )}

      {/* Step 2: Adjust segmentation + copy LLM prompt */}
      {step === 'segment' && (
        <div className="space-y-4">
          {isTutorial && tutorialStep === 1 && (
            <TutorialBanner visibleAt={1}>
              The app auto-segmented the sentence using the CC-CEDICT dictionary. You can
              split or merge tokens if needed. Normally you'd copy a prompt to an LLM to get
              pinyin and meanings &mdash; for this tutorial, click <strong>Use Tutorial Data</strong> to skip that step.
            </TutorialBanner>
          )}

          <div className="p-3 rounded-lg inset">
            <div className="text-lg">{chinese}</div>
          </div>

          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Adjust word boundaries: click a word to split into characters, or{' '}
            <strong>+</strong> to merge adjacent tokens.
          </p>

          {/* Segment editing */}
          <div className="flex flex-wrap gap-1 items-center p-3 rounded-lg surface">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center">
                <button
                  onClick={() => handleSplitSegment(i)}
                  className="px-3 py-2 rounded-lg text-xl transition-colors"
                  style={{ border: '2px solid var(--border)', background: 'var(--bg-surface)' }}
                  title={seg.length > 1 ? 'Click to split' : 'Single character'}
                >
                  {seg}
                </button>
                {i < segments.length - 1 && (
                  <button
                    onClick={() => handleMergeSegments(i)}
                    className="mx-0.5 px-1 text-lg font-bold"
                    style={{ color: 'var(--text-tertiary)' }}
                    title="Merge with next"
                  >
                    +
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Tutorial shortcut or normal LLM flow */}
          {isTutorial && tutorialStep === 1 ? (
            <button
              onClick={handleTutorialSkipLLM}
              className="w-full py-3 rounded-lg font-medium transition-colors ring-2 ring-offset-2"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Use Tutorial Data
            </button>
          ) : (
            <div className="p-4 rounded-lg space-y-3 inset" style={{ border: '1px solid var(--border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                1. Copy the analysis prompt (includes your segmentation + existing meanings)
              </p>
              <button
                onClick={handleCopyPrompt}
                className="w-full py-2 rounded font-medium text-sm transition-colors"
                style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
              >
                {promptCopied ? 'Copied!' : 'Copy Prompt to Clipboard'}
              </button>

              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                2. Paste it into ChatGPT / Claude / any LLM, then paste the response below
              </p>
              <textarea
                value={llmPasteValue}
                onChange={(e) => setLlmPasteValue(e.target.value)}
                placeholder="Paste the JSON response here..."
                rows={6}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={handleParseLLMResponse}
                disabled={!llmPasteValue.trim()}
                className="w-full py-2 rounded font-medium text-sm transition-colors disabled:opacity-50"
                style={{ background: 'var(--success)', color: 'var(--text-inverted)' }}
              >
                Parse &amp; Fill
              </button>
            </div>
          )}

          <button
            onClick={() => setStep('input')}
            className="w-full py-2 rounded-lg font-medium text-sm transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Step 3: Review filled tokens */}
      {step === 'review' && (
        <div className="space-y-4">
          {isTutorial && tutorialStep === 1 && (
            <TutorialBanner visibleAt={1}>
              Here's each token with its pinyin, part of speech, and English meaning. You can
              edit any field by clicking "Edit fields." When you're happy, click <strong>Review &amp; Save</strong>.
            </TutorialBanner>
          )}

          <div className="p-3 rounded-lg inset">
            <div className="text-lg">{chinese}</div>
          </div>

          {/* Sentence-level English */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Sentence Translation
              {!english && <span className="ml-1" style={{ color: 'var(--danger)' }}>*</span>}
            </label>
            <input
              type="text"
              value={english}
              onChange={(e) => setEnglish(e.target.value)}
              placeholder="English translation of the full sentence"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: !english ? 'var(--warning-subtle)' : 'var(--bg-surface)',
                border: `1px solid ${!english ? 'var(--warning)' : 'var(--border)'}`,
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Per-token detail forms */}
          <div className="space-y-3">
            {tokens.map((t, i) => (
              <div key={i} className="p-4 rounded-lg space-y-2" style={{ border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{t.surfaceForm}</span>
                  {t.pinyinSandhi && (
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t.pinyinSandhi}</span>
                  )}
                  {!t.pinyinSandhi && t.pinyinNumeric && (
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {numericStringToDiacritic(t.pinyinNumeric)}
                    </span>
                  )}
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{t.partOfSpeech}</span>
                  <span className="flex-1 text-right text-sm">{t.english}</span>
                </div>

                {/* Editable fields (collapsed by default, expand if needed) */}
                <details className="text-sm">
                  <summary className="cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                    Edit fields
                  </summary>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Pinyin (tone numbers)</label>
                      <input
                        type="text"
                        value={t.pinyinNumeric}
                        onChange={(e) => updateToken(i, 'pinyinNumeric', e.target.value)}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>English meaning</label>
                      <input
                        type="text"
                        value={t.english}
                        onChange={(e) => updateToken(i, 'english', e.target.value)}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Tone sandhi pinyin</label>
                      <input
                        type="text"
                        value={t.pinyinSandhi}
                        onChange={(e) => updateToken(i, 'pinyinSandhi', e.target.value)}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Part of speech</label>
                      <select
                        value={t.partOfSpeech}
                        onChange={(e) => updateToken(i, 'partOfSpeech', e.target.value)}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      >
                        <option value="">Select...</option>
                        <option value="noun">Noun</option>
                        <option value="verb">Verb</option>
                        <option value="adj">Adjective</option>
                        <option value="adv">Adverb</option>
                        <option value="prep">Preposition</option>
                        <option value="conj">Conjunction</option>
                        <option value="particle">Particle</option>
                        <option value="measure">Measure word</option>
                        <option value="pronoun">Pronoun</option>
                        <option value="number">Number</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>

                </details>

                {/* Character breakdowns — always visible + editable for multi-char words */}
                {t.characters && t.characters.length > 1 && (
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                      Character breakdown (verify these are standalone meanings, not the whole word's meaning):
                    </div>
                    <div className="space-y-2">
                      {t.characters.map((c, ci) => (
                        <div key={ci} className="flex items-center gap-2">
                          <span className="text-lg w-8 text-center">{c.char}</span>
                          <span className="text-xs w-12" style={{ color: 'var(--text-tertiary)' }}>[{c.pinyinNumeric}]</span>
                          <input
                            type="text"
                            value={c.english}
                            onChange={(e) => updateCharacter(i, ci, 'english', e.target.value)}
                            className="flex-1 px-2 py-1 border rounded text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep('segment')}
              className="flex-1 py-3 rounded-lg font-medium transition-colors"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                isTutorial && tutorialStep === 1 ? 'ring-2 ring-offset-2' : ''
              }`}
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Review &amp; Save
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === 'confirm' && (
        <div className="space-y-4">
          {isTutorial && tutorialStep === 1 && (
            <TutorialBanner visibleAt={1}>
              Everything looks good! Click <strong>Save Sentence</strong> to add it to your deck.
              The other two example sentences will be added automatically.
            </TutorialBanner>
          )}

          <div className="p-4 rounded-lg surface space-y-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Sentence</div>
              <div className="text-2xl">{chinese}</div>
              <div style={{ color: 'var(--text-secondary)' }}>{english}</div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Word Breakdown</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'auto auto 1fr auto' }}>
                <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Word</div>
                <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Pinyin</div>
                <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Meaning</div>
                <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Type</div>
                {tokens.map((t, i) => (
                  <Fragment key={i}>
                    <span className="text-lg">{t.surfaceForm}</span>
                    <span className="text-sm self-center" style={{ color: 'var(--text-secondary)' }}>
                      {t.pinyinSandhi || numericStringToDiacritic(t.pinyinNumeric)}
                    </span>
                    <span className="text-sm self-center">{t.english}</span>
                    <span className="text-xs self-center" style={{ color: 'var(--text-tertiary)' }}>{t.partOfSpeech}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 text-xs rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            This will create meaning entries for each token and 3 review cards
            (EN&rarr;ZH, ZH&rarr;EN, and PY&rarr;EN+ZH).
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => setStep('review')}
              className="flex-1 py-3 rounded-lg font-medium transition-colors"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
            >
              Back
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                isTutorial && tutorialStep === 1 ? 'ring-2 ring-offset-2' : ''
              }`}
              style={{ background: 'var(--success)', color: 'var(--text-inverted)' }}
            >
              {saving ? 'Saving...' : 'Save Sentence'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
