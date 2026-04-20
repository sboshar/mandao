import { useState, useEffect, useRef, Fragment } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { ingestSentence, type TokenInput, type CharacterInput } from '../services/ingestion';
import {
  generateAnalysisPrompt,
  parseLLMResponse,
  getExistingMeanings,
} from '../services/llmPrompt';
import { processLLMTokens } from '../services/processLLMTokens';
import { checkPinyin, type CheckPinyinFlag } from '../lib/checkPinyin';
import { numericStringToDiacritic } from '../services/toneSandhi';
import { generateCompletion, isAIConfigured } from '../services/aiProvider';
import { PinyinIMEInput } from '../components/PinyinIMEInput';
import { TutorialBanner } from '../components/TutorialBanner';
import { TagInput } from '../components/TagInput';
import { useTutorialStore } from '../stores/tutorialStore';
import { useSyncStore } from '../stores/syncStore';
import { TUTORIAL_SENTENCES } from '../data/tutorialSentences';
import {
  isSpeechRecognitionSupported,
  CANCELLED_MESSAGE,
} from '../services/speechRecognition';
import {
  startStreamingRecognitionWithAudio,
  isAudioRecordingSupported,
  formatDuration,
  playBlob,
  type RecordingResult,
  type StreamingWithAudioHandle,
} from '../services/audioRecording';
import { pinyin as toPinyin } from 'pinyin-pro';
import { computeTokenCoverage } from '../services/tokenCoverage';
import { v4 as uuid } from 'uuid';
import * as repo from '../db/repo';
import type { AudioRecording } from '../db/schema';

interface TokenFormData {
  surfaceForm: string;
  pinyinNumeric: string;
  pinyinSandhi: string;
  english: string;
  partOfSpeech: string;
  isTransliteration?: boolean;
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
  const [tokens, setTokens] = useState<TokenFormData[]>([]);
  const [step, setStep] = useState<'input' | 'llm' | 'review' | 'confirm'>('input');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [llmPasteValue, setLlmPasteValue] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  /** True when the user explicitly chose the copy-prompt-manually path from the input step. */
  const [manualMode, setManualMode] = useState(false);
  const [usePinyinIME, setUsePinyinIME] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  /** Chars the analyzer dropped — nonzero until user re-analyzes or adds them manually. */
  const [missingChars, setMissingChars] = useState<string[]>([]);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [ingestFlags, setIngestFlags] = useState<CheckPinyinFlag[]>([]);
  const [rawLLMResponse, setRawLLMResponse] = useState<string | null>(null);
  const [showRawLLM, setShowRawLLM] = useState(false);
  const aiEnabled = isAIConfigured();
  const [listening, setListening] = useState(false);
  const speechSupported = isSpeechRecognitionSupported();
  const audioCaptureSupported = isAudioRecordingSupported();
  /** Last voice-input recording, pending user decision to keep it as a clip. */
  const [pendingVoiceClip, setPendingVoiceClip] = useState<RecordingResult | null>(null);
  const [pendingVoiceClipName, setPendingVoiceClipName] = useState('My voice');
  const [voicePlaying, setVoicePlaying] = useState(false);
  const stopVoicePlaybackRef = useRef<(() => void) | null>(null);
  /** Live (interim + final) transcript streaming from SpeechRecognition. */
  const [voiceInterim, setVoiceInterim] = useState('');
  const streamingHandleRef = useRef<StreamingWithAudioHandle | null>(null);

  /** Start/stop a continuous recognition + MediaRecorder session. */
  const handleVoiceInput = async () => {
    if (listening) {
      // User is toggling off — finalize the stream.
      const handle = streamingHandleRef.current;
      streamingHandleRef.current = null;
      setListening(false);
      if (handle) {
        try {
          const { transcript, audio } = await handle.stop();
          if (transcript) setChinese((prev) => prev + transcript);
          if (audio && audio.blob.size > 0) {
            setPendingVoiceClip(audio);
            setPendingVoiceClipName('My voice');
          }
        } catch (e: any) {
          if (e?.message !== CANCELLED_MESSAGE) {
            setError(e?.message || 'Voice recognition failed.');
          }
        } finally {
          setVoiceInterim('');
        }
      }
      return;
    }

    // Starting fresh.
    setError('');
    setVoiceInterim('');
    try {
      const handle = await startStreamingRecognitionWithAudio({
        onInterim: (text) => setVoiceInterim(text),
      });
      streamingHandleRef.current = handle;
      setListening(true);
    } catch (e: any) {
      setError(e?.message || 'Voice recognition failed.');
    }
  };

  const handlePlayPendingClip = () => {
    if (!pendingVoiceClip) return;
    if (voicePlaying) {
      stopVoicePlaybackRef.current?.();
      setVoicePlaying(false);
      return;
    }
    setVoicePlaying(true);
    stopVoicePlaybackRef.current = playBlob(pendingVoiceClip.blob, () => setVoicePlaying(false));
  };

  const handleDiscardPendingClip = () => {
    stopVoicePlaybackRef.current?.();
    setVoicePlaying(false);
    setPendingVoiceClip(null);
  };

  /** Local pinyin preview (pinyin-pro, no LLM, no network). */
  const livePinyin = (() => {
    const src = listening ? voiceInterim || chinese : chinese;
    if (!src.trim()) return '';
    try {
      return toPinyin(src, { toneType: 'symbol', type: 'string' });
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    return () => {
      // Cancel both SpeechRecognition and the parallel MediaRecorder if still active.
      streamingHandleRef.current?.cancel();
      streamingHandleRef.current = null;
    };
  }, []);

  // Tutorial mode: pre-fill Chinese sentence
  useEffect(() => {
    if (isTutorial && tutorialStep === 1 && step === 'input') {
      setChinese(TUTORIAL_SENTENCES[0].chinese);
    }
  }, [isTutorial, tutorialStep, step]);

  // Step 1 → Step 2.
  // Instant indexed dedup check so a duplicate never triggers an LLM call.
  // When AI is configured (and not in tutorial), skip the manual copy-paste
  // screen and auto-analyze directly — that screen is pointless friction.
  const handleNext = async () => {
    const trimmed = chinese.trim();
    if (!trimmed) {
      setError('Please enter a Chinese sentence.');
      return;
    }
    if (!isTutorial) {
      const existing = await repo.getSentenceByNormalizedChinese(trimmed);
      if (existing) {
        setError(`This sentence is already in your deck: "${existing.chinese}"`);
        return;
      }
    }
    setError('');
    if (aiEnabled && !isTutorial) {
      await handleAutoAnalyze();
      return;
    }
    setStep('llm');
  };

  const handleChineseChange = (next: string) => {
    setChinese(next);
  };

  // Copy LLM prompt (LLM handles tokenization)
  const handleCopyPrompt = async () => {
    setError('');
    const existingMeanings = await getExistingMeanings(chinese.trim());
    const prompt = await generateAnalysisPrompt(chinese.trim(), existingMeanings);
    await navigator.clipboard.writeText(prompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  /** Apply a parsed LLM response to review-step state: policy, english,
   *  flags, form tokens, missing-char coverage. Callers own setStep. */
  const applyAnalysis = (parsed: ReturnType<typeof parseLLMResponse>) => {
    const processed = processLLMTokens(parsed);
    if (parsed.english) setEnglish(parsed.english);
    setIngestFlags(processed.flags);

    const formTokens: TokenFormData[] = processed.tokens.map((t) => ({
      surfaceForm: t.surfaceForm,
      pinyinNumeric: t.pinyinNumeric,
      pinyinSandhi: t.pinyinSandhi || '',
      english: t.english,
      partOfSpeech: t.partOfSpeech || '',
      isTransliteration: !!t.isTransliteration,
      characters: t.characters?.map((c) => ({
        char: c.char,
        pinyinNumeric: c.pinyinNumeric,
        pinyinSandhi: c.pinyinSandhi,
        english: c.english,
      })),
    }));

    setTokens(formTokens);
    const cov = computeTokenCoverage(chinese.trim(), formTokens);
    setMissingChars(cov.missing.map((m) => m.surfaceForm));
  };

  // Auto-analyze using configured AI provider
  const handleAutoAnalyze = async () => {
    setError('');
    setAnalyzing(true);
    try {
      const existingMeanings = await getExistingMeanings(chinese.trim());
      const prompt = await generateAnalysisPrompt(chinese.trim(), existingMeanings);
      const raw = await generateCompletion(prompt);
      setRawLLMResponse(raw);
      const parsed = parseLLMResponse(raw);
      applyAnalysis(parsed);
      setStep('review');
    } catch (e: any) {
      setError(e.message);
    }
    setAnalyzing(false);
  };

  // Parse LLM JSON response
  const handleParseLLMResponse = () => {
    try {
      setRawLLMResponse(llmPasteValue);
      const parsed = parseLLMResponse(llmPasteValue);
      applyAnalysis(parsed);
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
    if (missingChars.length > 0) {
      const cov = computeTokenCoverage(chinese.trim(), newTokens);
      setMissingChars(cov.missing.map((m) => m.surfaceForm));
    }
  };

  /** Accept a CEDICT suggestion for all tokens with the given headword.
   *  Updates pinyinNumeric inline and drops the now-resolved flag. */
  const applyCedictSuggestion = (headword: string, suggestion: string) => {
    setTokens((prev) =>
      prev.map((t) =>
        t.surfaceForm === headword ? { ...t, pinyinNumeric: suggestion } : t,
      ),
    );
    setIngestFlags((prev) => prev.filter((f) => f.headword !== headword));
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

  /** Re-run the analyzer with an explicit hint about which chars it dropped. */
  const handleReanalyze = async () => {
    setError('');
    setReanalyzing(true);
    try {
      const existingMeanings = await getExistingMeanings(chinese.trim());
      const prompt = await generateAnalysisPrompt(chinese.trim(), existingMeanings, missingChars);
      const raw = await generateCompletion(prompt);
      setRawLLMResponse(raw);
      const parsed = parseLLMResponse(raw);
      applyAnalysis(parsed);
    } catch (e: any) {
      setError(e.message || 'Re-analyze failed');
    }
    setReanalyzing(false);
  };

  /** Insert missing chars at their positional slots as placeholder tokens. */
  const handleAddMissingManually = () => {
    const cov = computeTokenCoverage(chinese.trim(), tokens);
    if (cov.complete) {
      setMissingChars([]);
      return;
    }
    const next = [...tokens];
    // Insert in reverse order so earlier insertAtIndex values stay valid.
    for (const m of [...cov.missing].reverse()) {
      next.splice(m.insertAtIndex, 0, {
        surfaceForm: m.surfaceForm,
        pinyinNumeric: m.pinyinNumeric,
        pinyinSandhi: '',
        english: '',
        partOfSpeech: '',
        characters: [{
          char: m.surfaceForm,
          pinyinNumeric: m.pinyinNumeric,
          english: '',
        }],
      });
    }
    setTokens(next);
    const recheck = computeTokenCoverage(chinese.trim(), next);
    setMissingChars(recheck.missing.map((m) => m.surfaceForm));
  };

  const handleConfirm = () => {
    if (!english.trim()) {
      setError('Please provide an English translation for the sentence.');
      return;
    }
    // Re-check coverage using current tokens (user may have edited surfaceForms).
    const cov = computeTokenCoverage(chinese.trim(), tokens);
    if (!cov.complete) {
      setMissingChars(cov.missing.map((m) => m.surfaceForm));
      setError(`These characters are not covered by any token: ${cov.missing.map((m) => m.surfaceForm).join(' ')}. Re-analyze or add them manually.`);
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
        isTransliteration: t.isTransliteration,
        characters: t.characters,
      }));

      // Flags record what the LLM originally emitted vs what finally
      // Recompute flags from the final tokenInputs so user edits on the
      // review screen (manual edits, apply-CEDICT clicks, token removal)
      // are reflected in the persisted flags. Original LLM value comes
      // from ingestFlags snapshot; if the user added tokens that weren't
      // in the LLM response, llmValue equals the current pinyin.
      const llmValueByHeadword = new Map<string, string>();
      for (const f of ingestFlags) llmValueByHeadword.set(f.headword, f.llmValue);
      const flagsForSave = tokenInputs
        .map((t) => {
          const check = checkPinyin(t.surfaceForm, t.pinyinNumeric);
          if (!check.flag) return null;
          return {
            headword: t.surfaceForm,
            storedPinyin: t.pinyinNumeric,
            llmValue: llmValueByHeadword.get(t.surfaceForm) ?? t.pinyinNumeric,
            flagKind: check.flag.kind,
            cedictSuggestions: check.cedictSuggestions,
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      let createdSentenceId: string | null = null;
      try {
        createdSentenceId = await ingestSentence({
          chinese: chinese.trim(),
          english: english.trim(),
          tokens: tokenInputs,
          tags,
          flags: flagsForSave,
        });
      } catch (e: any) {
        // In tutorial mode, skip duplicate errors so re-running works
        if (!(isTutorial && e.message?.includes('already exists'))) {
          throw e;
        }
      }

      // Persist the voice-input recording as a named audio clip on the new sentence.
      if (createdSentenceId && pendingVoiceClip && pendingVoiceClip.blob.size > 0) {
        const rec: AudioRecording = {
          id: uuid(),
          sentenceId: createdSentenceId,
          name: pendingVoiceClipName.trim() || 'My voice',
          blob: pendingVoiceClip.blob,
          mimeType: pendingVoiceClip.mimeType,
          durationMs: pendingVoiceClip.durationMs,
          source: 'voice-input',
          createdAt: Date.now(),
        };
        try { await repo.insertAudioRecording(rec); } catch {}
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
        setTokens([]);
        setTags([]);
        setStep('input');
        setPendingVoiceClip(null);
        stopVoicePlaybackRef.current?.();
        setVoiceInterim('');
        setMissingChars([]);
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
                <div className="flex items-center gap-2">
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={handleVoiceInput}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        listening
                          ? 'bg-red-100 border-red-300 text-red-700'
                          : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                      }`}
                      title={listening ? 'Stop listening' : 'Speak a sentence'}
                    >
                      {listening ? (
                        <span className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                          Stop
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                          Voice
                        </span>
                      )}
                    </button>
                  )}
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
                </div>
              )}
            </div>
            {usePinyinIME && !(isTutorial && tutorialStep === 1) ? (
              <PinyinIMEInput
                value={chinese}
                onChange={handleChineseChange}
                placeholder="Type pinyin, e.g. nihao"
              />
            ) : (
              <input
                type="text"
                value={chinese}
                onChange={(e) => handleChineseChange(e.target.value)}
                placeholder="他差不多吃完了。"
                className="w-full px-3 py-2 rounded-lg focus:ring-2 text-lg"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                lang="zh"
                readOnly={isTutorial && tutorialStep === 1}
              />
            )}
            {listening && voiceInterim && (
              <div className="mt-2 text-lg" style={{ color: 'var(--text-tertiary)' }}>
                {voiceInterim}
              </div>
            )}
            {livePinyin && (
              <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {livePinyin}
              </div>
            )}
          </div>

          {pendingVoiceClip && audioCaptureSupported && (
            <div className="p-3 rounded-lg space-y-2"
              style={{ background: 'var(--bg-inset)', border: '1px solid var(--border)' }}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Save your recording?{' '}
                  <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>
                    (optional)
                  </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {formatDuration(pendingVoiceClip.durationMs)}
                </span>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                It'll be attached to this sentence alongside the default Google voice. Skip it with Discard.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePlayPendingClip}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--accent)' }}
                >
                  {voicePlaying ? '■ Stop' : '▶ Play'}
                </button>
                <input
                  type="text"
                  value={pendingVoiceClipName}
                  onChange={(e) => setPendingVoiceClipName(e.target.value)}
                  placeholder="Name this recording"
                  className="flex-1 px-2 py-1 rounded text-sm"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
                <button
                  type="button"
                  onClick={handleDiscardPendingClip}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
          <button
            onClick={handleNext}
            disabled={!chinese.trim() || analyzing}
            className={`w-full py-3 rounded-lg font-medium disabled:opacity-50 transition-colors ${
              isTutorial && tutorialStep === 1 ? 'ring-2 ring-offset-2' : ''
            }`}
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            {analyzing
              ? 'Analyzing...'
              : aiEnabled && !isTutorial
                ? 'Analyze with AI'
                : 'Next: Analyze with LLM'}
          </button>
          {aiEnabled && !isTutorial && (
            <button
              type="button"
              onClick={() => {
                if (!chinese.trim()) return;
                setError('');
                setManualMode(true);
                setStep('llm');
              }}
              disabled={!chinese.trim() || analyzing}
              className="w-full text-xs mt-1 underline disabled:opacity-50"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Or copy prompt manually
            </button>
          )}
        </div>
      )}

      {/* Step 2: Copy LLM prompt + paste response */}
      {step === 'llm' && (
        <div className="space-y-4">
          {isTutorial && tutorialStep === 1 && (
            <TutorialBanner visibleAt={1}>
              Normally you'd copy a prompt to an LLM to get tokenization, pinyin, and
              meanings &mdash; for this tutorial, click <strong>Use Tutorial Data</strong> to skip that step.
            </TutorialBanner>
          )}

          <div className="p-3 rounded-lg inset">
            <div className="text-lg">{chinese}</div>
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
            <div className="space-y-3">
              {/* Hint: configure AI */}
              {!aiEnabled && (
                <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
                  Tip: You can automate this step.{' '}
                  <Link to="/settings" className="underline font-medium" style={{ color: 'var(--accent)' }}>
                    Configure an AI provider
                  </Link>{' '}
                  in Settings to analyze sentences with one click.
                </div>
              )}

              {/* Auto-analyze (when AI is configured and user didn't explicitly choose manual) */}
              {aiEnabled && !manualMode && (
                <button
                  onClick={handleAutoAnalyze}
                  disabled={analyzing}
                  className="w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-70"
                  style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
                >
                  {analyzing ? 'Analyzing...' : 'Auto-Analyze with AI'}
                </button>
              )}

              {/* Manual copy-paste flow */}
              {(() => {
                const body = (
                  <div className="mt-2 p-4 rounded-lg space-y-3 inset" style={{ border: '1px solid var(--border)' }}>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      1. Copy the analysis prompt (the LLM will tokenize and analyze the sentence)
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
                );
                // When AI is configured and the user hasn't explicitly chosen the manual
                // path, keep the old collapsible affordance below the Auto-Analyze button.
                // Otherwise render the content flat — the user has already committed to manual.
                return aiEnabled && !manualMode ? (
                  <details>
                    <summary
                      className="cursor-pointer text-sm font-medium py-1"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Or paste LLM response manually
                    </summary>
                    {body}
                  </details>
                ) : (
                  body
                );
              })()}
            </div>
          )}

          <button
            onClick={() => {
              setManualMode(false);
              setStep('input');
            }}
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

          {ingestFlags.length > 0 && (
            <div className="p-3 rounded-lg text-xs space-y-2"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              <div style={{ color: 'var(--text-primary)' }}>
                {ingestFlags.length} token{ingestFlags.length === 1 ? '' : 's'} disagree with CC-CEDICT — review below.
              </div>
              {ingestFlags.slice(0, 5).map((f, i) => (
                <div key={i} className="font-mono flex flex-wrap items-center gap-1">
                  <span style={{ color: 'var(--text-primary)' }}>{f.headword}:</span>
                  <span>{f.llmValue || '(empty)'}</span>
                  {f.cedictSuggestions.length > 0 && (
                    <>
                      <span style={{ opacity: 0.6 }}>→ CEDICT:</span>
                      {f.cedictSuggestions.map((sugg) => (
                        <button
                          key={sugg}
                          type="button"
                          onClick={() => applyCedictSuggestion(f.headword, sugg)}
                          className="px-1.5 py-0.5 rounded transition-colors"
                          style={{
                            background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
                            color: 'var(--accent)',
                            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                          }}
                        >
                          {sugg}
                        </button>
                      ))}
                    </>
                  )}
                  <span style={{ opacity: 0.5 }}>({f.kind})</span>
                </div>
              ))}
              {ingestFlags.length > 5 && <div style={{ opacity: 0.6 }}>…and {ingestFlags.length - 5} more</div>}
            </div>
          )}

          {rawLLMResponse && (
            <details
              className="rounded-lg text-xs"
              style={{ border: '1px solid var(--border)' }}
              open={showRawLLM}
              onToggle={(e) => setShowRawLLM((e.target as HTMLDetailsElement).open)}
            >
              <summary
                className="px-3 py-2 cursor-pointer select-none"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Raw LLM response
              </summary>
              <pre
                className="px-3 pb-3 overflow-auto font-mono"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', maxHeight: '24rem' }}
              >
                {rawLLMResponse}
              </pre>
            </details>
          )}

          {missingChars.length > 0 && (
            <div className="p-3 rounded-lg space-y-2"
              style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger)' }}>
              <div className="text-sm" style={{ color: 'var(--danger)' }}>
                Analysis skipped these characters:{' '}
                <span className="font-bold text-base">{missingChars.join(' ')}</span>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Every character in the sentence must be covered by a token before saving.
              </div>
              <div className="flex gap-2">
                {aiEnabled && (
                  <button
                    type="button"
                    onClick={handleReanalyze}
                    disabled={reanalyzing}
                    className="text-xs px-3 py-1 rounded font-medium disabled:opacity-60"
                    style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
                  >
                    {reanalyzing ? 'Re-analyzing…' : 'Re-analyze with AI'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddMissingManually}
                  className="text-xs px-3 py-1 rounded font-medium"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                >
                  Add manually
                </button>
              </div>
            </div>
          )}

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
                    <label className="flex items-center gap-2 mb-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={!!t.isTransliteration}
                        onChange={(e) => {
                          const newTokens = [...tokens];
                          newTokens[i] = { ...newTokens[i], isTransliteration: e.target.checked };
                          setTokens(newTokens);
                        }}
                      />
                      Phonetic loanword (characters approximate a foreign sound, not meaning — e.g. 汉堡 = hamburger)
                    </label>
                    <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                      {t.isTransliteration
                        ? "Character breakdown (phonetic gloss — each character contributes sound, not literal meaning):"
                        : "Character breakdown (verify these are standalone meanings, not the whole word's meaning):"}
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
              onClick={() => setStep('input')}
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
