import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import * as repo from '../db/repo';
import type { Meaning, Sentence, SrsCard } from '../db/schema';
import {
  getSentencesForMeaning,
  getOtherMeanings,
  getCharacterBreakdown,
} from '../services/ingestion';
import { ClickableChar } from './ClickableChar';
import { ClickablePinyin } from './ClickablePinyin';
import { PinyinCard } from './PinyinCard';
import { AudioButton } from './AudioButton';
import { TokenSpan } from './TokenSpan';
import { PinyinDisplay } from './PinyinDisplay';
import { ClickableEnglish } from './ClickableEnglish';
import { EnglishCard } from './EnglishCard';
import { getTokensForSentence } from '../services/ingestion';
import { TutorialBanner } from './TutorialBanner';
import { useTutorialStore } from '../stores/tutorialStore';
import type { SentenceToken } from '../db/schema';

interface CharBreakdownItem {
  childMeaning: Meaning;
  position: number;
}

function MeaningContent() {
  const { current, push } = useNavigationStore();
  const [meaning, setMeaning] = useState<Meaning | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [otherMeanings, setOtherMeanings] = useState<Meaning[]>([]);
  const [charBreakdown, setCharBreakdown] = useState<CharBreakdownItem[]>([]);

  const entry = current();

  useEffect(() => {
    if (!entry || entry.type !== 'meaning') {
      setMeaning(null);
      return;
    }

    let cancelled = false;

    async function load() {
      const m = await repo.getMeaning(entry!.id);
      if (cancelled || !m) return;
      setMeaning(m);

      const [sents, others, breakdown] = await Promise.all([
        getSentencesForMeaning(m.id),
        getOtherMeanings(m),
        getCharacterBreakdown(m.id),
      ]);

      if (cancelled) return;
      setSentences(sents);
      setOtherMeanings(others);
      setCharBreakdown(breakdown);
    }

    load();
    return () => { cancelled = true; };
  }, [entry]);

  if (!meaning) return null;

  const pinyinSyllables = meaning.pinyin.split(/\s+/);
  const pinyinNumericSyllables = meaning.pinyinNumeric.split(/\s+/);
  const headwordChars = Array.from(meaning.headword);

  return (
    <>
      <div className="p-4 sm:p-6 text-center">
        <div className="text-4xl sm:text-5xl mb-2">
          {headwordChars.map((char, i) => (
            <ClickableChar
              key={i}
              char={char}
              meaningId={headwordChars.length === 1 ? meaning.id : undefined}
              className="px-0.5"
            />
          ))}
        </div>

        <div className="text-lg">
          {pinyinSyllables.map((syllable, i) => (
            <span key={i}>
              <ClickablePinyin
                pinyin={syllable}
                pinyinNumeric={pinyinNumericSyllables[i] || ''}
              />
              {i < pinyinSyllables.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>

        <AudioButton text={meaning.headword} className="mt-2" />
        <div className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{meaning.partOfSpeech}</div>
        <div className="mt-1 text-xl">
          <ClickableEnglish text={meaning.englishShort} />
        </div>
        {meaning.englishFull !== meaning.englishShort && (
          <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <ClickableEnglish text={meaning.englishFull} />
          </div>
        )}
      </div>

      {sentences.length > 0 && (
        <div className="px-6 pb-4">
          <h3 className="text-sm font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Example Sentences
          </h3>
          <div className="space-y-2">
            {sentences.map((s) => (
              <div
                key={s.id}
                className="p-3 rounded cursor-pointer transition-colors inset surface-hover"
                onClick={() => push({ type: 'sentence', id: s.id })}
              >
                <div className="text-lg">{s.chinese}</div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{s.pinyinSandhi}</div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <ClickableEnglish text={s.english} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {otherMeanings.length > 0 && (
        <div className="px-6 pb-4">
          <h3 className="text-sm font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Other Meanings of "{meaning.headword}"
          </h3>
          <div className="space-y-1">
            {otherMeanings.map((m) => (
              <button
                key={m.id}
                onClick={() => push({ type: 'meaning', id: m.id })}
                className="block w-full text-left p-2 rounded transition-colors surface-hover"
              >
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{m.pinyin}</span>
                <span className="ml-2">{m.englishShort}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {charBreakdown.length > 0 && (
        <div className="px-6 pb-6">
          <h3 className="text-sm font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Character Breakdown
          </h3>
          <div className="flex gap-4 justify-center">
            {charBreakdown.map((item) => (
              <button
                key={item.childMeaning.id}
                onClick={() => push({ type: 'meaning', id: item.childMeaning.id })}
                className="flex flex-col items-center p-3 rounded transition-colors surface-hover"
              >
                <span className="text-3xl">{item.childMeaning.headword}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {item.childMeaning.pinyin}
                </span>
                <span className="text-xs">{item.childMeaning.englishShort}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

const SRS_STATE_LABELS = ['New', 'Learning', 'Review', 'Relearning'] as const;
const SRS_STATE_COLORS = ['var(--state-new, #3b82f6)', 'var(--state-learning, #f97316)', 'var(--state-review, #22c55e)', 'var(--state-relearning, #a855f7)'];
const SRS_MODE_LABELS: Record<string, string> = { 'en-to-zh': 'EN\u2192ZH', 'zh-to-en': 'ZH\u2192EN', 'py-to-en-zh': 'PY\u2192EN+ZH' };

function formatDue(due: number): string {
  const diff = due - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SentenceContent() {
  const { current } = useNavigationStore();
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);
  const [srsCards, setSrsCards] = useState<SrsCard[]>([]);
  const [showSrs, setShowSrs] = useState(false);

  const entry = current();

  useEffect(() => {
    if (!entry || entry.type !== 'sentence') {
      setSentence(null);
      return;
    }

    let cancelled = false;
    async function load() {
      const s = await repo.getSentence(entry!.id);
      if (cancelled || !s) return;
      setSentence(s);

      const [toks, cards] = await Promise.all([
        getTokensForSentence(s.id),
        repo.getSrsCardsBySentence(s.id),
      ]);
      if (!cancelled) {
        setTokens(toks);
        setSrsCards(cards);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [entry]);

  if (!sentence) return null;

  return (
    <div className="p-6">
      <div className="text-center mb-4">
        <div className="flex flex-wrap justify-center gap-1 mb-2">
          {tokens.map((t) => (
            <TokenSpan
              key={t.id}
              meaningId={t.meaningId}
              surfaceForm={t.surfaceForm}
              pinyin={t.meaning.pinyin}
              pinyinNumeric={t.meaning.pinyinNumeric}

              showPinyin
            />
          ))}
        </div>
        <PinyinDisplay
          pinyin={sentence.pinyinSandhi}
          basePinyin={sentence.pinyin}
          className="text-sm"
        />
        <div className="text-base mt-1" style={{ color: 'var(--text-secondary)' }}>
          <ClickableEnglish text={sentence.english} />
        </div>
        <AudioButton text={sentence.chinese} className="mt-2" />
      </div>

      {srsCards.length > 0 && (
        <div className="pt-3 text-center">
          <button
            onClick={() => setShowSrs(!showSrs)}
            className="text-xs px-2.5 py-1 rounded-full transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
          >
            SRS status {showSrs ? '\u25B2' : '\u25BC'}
          </button>
          {showSrs && (
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {srsCards
                .sort((a, b) => a.reviewMode.localeCompare(b.reviewMode))
                .map((card) => (
                <div
                  key={card.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                  style={{ background: 'var(--bg-inset)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>{SRS_MODE_LABELS[card.reviewMode]}</span>
                  <span
                    className="px-1.5 py-0.5 rounded-full"
                    style={{ background: SRS_STATE_COLORS[card.state], color: 'white', fontSize: '0.65rem' }}
                  >
                    {SRS_STATE_LABELS[card.state]}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    {card.state === 0 ? '' : `due ${formatDue(card.due)}`}
                  </span>
                  {card.reps > 0 && (
                    <span style={{ color: 'var(--text-tertiary)' }}>· {card.reps} reps</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MeaningCard() {
  const { isOpen, current, goBack, goForward, canGoBack, canGoForward, close } =
    useNavigationStore();
  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);

  const entry = current();

  useEffect(() => {
    if (isOpen && entry && tutorialStep === 4) {
      advanceTutorial();
    }
  }, [isOpen, entry, tutorialStep, advanceTutorial]);

  const handleClose = () => {
    if (tutorialStep === 5) advanceTutorial();
    close();
  };

  if (!isOpen || !entry) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="surface rounded-lg shadow-xl max-w-lg w-full mx-3 sm:mx-4 max-h-[90vh] sm:max-h-[80vh] overflow-y-auto"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 sticky top-0 z-10 rounded-t-lg"
          style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex gap-2">
            <button
              onClick={goBack}
              disabled={!canGoBack()}
              className="px-2 py-1 rounded disabled:opacity-30 transition-colors"
              style={{ background: 'var(--bg-inset)' }}
            >
              &larr;
            </button>
            <button
              onClick={goForward}
              disabled={!canGoForward()}
              className="px-2 py-1 rounded disabled:opacity-30 transition-colors"
              style={{ background: 'var(--bg-inset)' }}
            >
              &rarr;
            </button>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {entry.type === 'meaning' && 'Meaning'}
            {entry.type === 'sentence' && 'Sentence'}
            {entry.type === 'pinyin' && 'Pinyin'}
            {entry.type === 'english' && 'English'}
          </div>
          <button
            onClick={handleClose}
            className="px-2 py-1 rounded transition-colors surface-hover"
          >
            &times;
          </button>
        </div>

        {/* Tutorial hint */}
        <div className="px-4 pt-2">
          <TutorialBanner visibleAt={5}>
            This is the <strong>meaning explorer</strong>. Notice how 花 has separate
            entries for "to spend" and "flower" under <strong>Other Meanings</strong>.
            <div className="mt-2">
              Try clicking a <strong>pinyin syllable</strong> (like huā) to see all characters
              with that sound, or click the <strong>arrows</strong> to go back and forward.
            </div>
            <div className="mt-2">
              When you're done exploring, close this panel to go back to the dashboard.
            </div>
          </TutorialBanner>
        </div>

        {entry.type === 'meaning' && <MeaningContent />}
        {entry.type === 'sentence' && <SentenceContent />}
        {entry.type === 'pinyin' && <PinyinCard />}
        {entry.type === 'english' && <EnglishCard />}
      </div>
    </div>
  );
}
