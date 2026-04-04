import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ingestSentence, type TokenInput, type CharacterInput } from '../services/ingestion';
import {
  generateAnalysisPrompt,
  parseLLMResponse,
  getExistingMeaningsForSegments,
} from '../services/llmPrompt';
import { tokenizeSentence } from '../services/tokenizer';
import { loadCedict, isLoaded as cedictLoaded } from '../lib/cedict';
import { numericStringToDiacritic } from '../services/toneSandhi';

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

  // Load dictionary on mount
  useEffect(() => {
    if (!cedictLoaded()) {
      setDictLoading(true);
      loadCedict().then(() => setDictLoading(false));
    }
  }, []);

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
    try {
      const tokenInputs: TokenInput[] = tokens.map((t) => ({
        surfaceForm: t.surfaceForm,
        pinyinNumeric: t.pinyinNumeric,
        english: t.english,
        partOfSpeech: t.partOfSpeech || 'other',
        characters: t.characters,
      }));

      await ingestSentence({
        chinese: chinese.trim(),
        english: english.trim(),
        tokens: tokenInputs,
      });

      setChinese('');
      setEnglish('');
      setSegments([]);
      setTokens([]);
      setStep('input');
      navigate('/');
    } catch (e: any) {
      setError(e.message || 'Failed to save sentence.');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Add Sentence</h1>
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
        >
          &larr; Back
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Step 1: Enter Chinese sentence */}
      {step === 'input' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chinese Sentence
            </label>
            <input
              type="text"
              value={chinese}
              onChange={(e) => setChinese(e.target.value)}
              placeholder="他差不多吃完了。"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500
                focus:border-blue-500 text-lg"
              lang="zh"
            />
          </div>
          <button
            onClick={handleSegment}
            disabled={dictLoading || !chinese.trim()}
            className="w-full py-3 rounded-lg bg-blue-500 text-white font-medium
              hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {dictLoading ? 'Loading dictionary...' : 'Next: Segment Words'}
          </button>
        </div>
      )}

      {/* Step 2: Adjust segmentation + copy LLM prompt */}
      {step === 'segment' && (
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg">{chinese}</div>
          </div>

          <p className="text-sm text-gray-500">
            Adjust word boundaries: click a word to split into characters, or{' '}
            <strong>+</strong> to merge adjacent tokens.
          </p>

          {/* Segment editing */}
          <div className="flex flex-wrap gap-1 items-center p-3 bg-white border rounded-lg">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center">
                <button
                  onClick={() => handleSplitSegment(i)}
                  className="px-3 py-2 border-2 border-blue-200 rounded-lg text-xl
                    hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  title={seg.length > 1 ? 'Click to split' : 'Single character'}
                >
                  {seg}
                </button>
                {i < segments.length - 1 && (
                  <button
                    onClick={() => handleMergeSegments(i)}
                    className="mx-0.5 px-1 text-gray-300 hover:text-blue-500 text-lg font-bold"
                    title="Merge with next"
                  >
                    +
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* LLM prompt flow */}
          <div className="p-4 border rounded-lg space-y-3 bg-gray-50">
            <p className="text-sm font-medium text-gray-700">
              1. Copy the analysis prompt (includes your segmentation + existing meanings)
            </p>
            <button
              onClick={handleCopyPrompt}
              className="w-full py-2 rounded bg-blue-500 text-white font-medium
                hover:bg-blue-600 text-sm transition-colors"
            >
              {promptCopied ? 'Copied!' : 'Copy Prompt to Clipboard'}
            </button>

            <p className="text-sm font-medium text-gray-700">
              2. Paste it into ChatGPT / Claude / any LLM, then paste the response below
            </p>
            <textarea
              value={llmPasteValue}
              onChange={(e) => setLlmPasteValue(e.target.value)}
              placeholder="Paste the JSON response here..."
              rows={6}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
            />
            <button
              onClick={handleParseLLMResponse}
              disabled={!llmPasteValue.trim()}
              className="w-full py-2 rounded bg-green-500 text-white font-medium
                hover:bg-green-600 text-sm transition-colors disabled:opacity-50"
            >
              Parse &amp; Fill
            </button>
          </div>

          <button
            onClick={() => setStep('input')}
            className="w-full py-2 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium text-sm"
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Step 3: Review filled tokens */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-lg">{chinese}</div>
          </div>

          {/* Sentence-level English */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sentence Translation
              {!english && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="text"
              value={english}
              onChange={(e) => setEnglish(e.target.value)}
              placeholder="English translation of the full sentence"
              className={`w-full px-3 py-2 border rounded-lg text-sm
                ${!english ? 'border-orange-300 bg-orange-50' : ''}`}
            />
          </div>

          {/* Per-token detail forms */}
          <div className="space-y-3">
            {tokens.map((t, i) => (
              <div key={i} className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{t.surfaceForm}</span>
                  {t.pinyinSandhi && (
                    <span className="text-sm text-gray-500">{t.pinyinSandhi}</span>
                  )}
                  {!t.pinyinSandhi && t.pinyinNumeric && (
                    <span className="text-sm text-gray-500">
                      {numericStringToDiacritic(t.pinyinNumeric)}
                    </span>
                  )}
                  <span className="text-sm text-gray-400">{t.partOfSpeech}</span>
                  <span className="flex-1 text-right text-sm">{t.english}</span>
                </div>

                {/* Editable fields (collapsed by default, expand if needed) */}
                <details className="text-sm">
                  <summary className="text-gray-400 cursor-pointer hover:text-gray-600">
                    Edit fields
                  </summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-0.5">Pinyin (tone numbers)</label>
                      <input
                        type="text"
                        value={t.pinyinNumeric}
                        onChange={(e) => updateToken(i, 'pinyinNumeric', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-0.5">English meaning</label>
                      <input
                        type="text"
                        value={t.english}
                        onChange={(e) => updateToken(i, 'english', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-0.5">Tone sandhi pinyin</label>
                      <input
                        type="text"
                        value={t.pinyinSandhi}
                        onChange={(e) => updateToken(i, 'pinyinSandhi', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-0.5">Part of speech</label>
                      <select
                        value={t.partOfSpeech}
                        onChange={(e) => updateToken(i, 'partOfSpeech', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
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
                    <div className="text-xs font-medium text-gray-500 mb-2">
                      Character breakdown (verify these are standalone meanings, not the whole word's meaning):
                    </div>
                    <div className="space-y-2">
                      {t.characters.map((c, ci) => (
                        <div key={ci} className="flex items-center gap-2">
                          <span className="text-lg w-8 text-center">{c.char}</span>
                          <span className="text-xs text-gray-400 w-12">[{c.pinyinNumeric}]</span>
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
              className="flex-1 py-3 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-3 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600"
            >
              Review &amp; Save
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg">
            <div className="text-2xl mb-1">{chinese}</div>
            <div className="text-gray-600 mb-3">{english}</div>
            <div className="space-y-2">
              {tokens.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 text-sm py-1 border-b last:border-0"
                >
                  <span className="text-lg w-16 text-right">{t.surfaceForm}</span>
                  <span className="text-gray-500 w-24">
                    {t.pinyinSandhi || numericStringToDiacritic(t.pinyinNumeric)}
                  </span>
                  <span className="flex-1">{t.english}</span>
                  <span className="text-gray-400 text-xs">{t.partOfSpeech}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-gray-500">
            This will create meaning entries for each token and 2 review cards
            (EN&rarr;ZH and ZH&rarr;EN).
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => setStep('review')}
              className="flex-1 py-3 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium"
            >
              Back
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 rounded-lg bg-green-500 text-white font-medium
                hover:bg-green-600 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Sentence'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
