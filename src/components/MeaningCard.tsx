import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { db } from '../db/db';
import type { Meaning, Sentence } from '../db/schema';
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
      const m = await db.meanings.get(entry!.id);
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
      {/* Headword — each character clickable, single-char stays in place */}
      <div className="p-6 text-center">
        <div className="text-5xl mb-2">
          {headwordChars.map((char, i) => (
            <ClickableChar
              key={i}
              char={char}
              meaningId={headwordChars.length === 1 ? meaning.id : undefined}
              className="px-0.5"
            />
          ))}
        </div>

        {/* Pinyin — each syllable clickable */}
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
        <div className="mt-2 text-gray-600 text-sm">{meaning.partOfSpeech}</div>
        <div className="mt-1 text-xl">
          <ClickableEnglish text={meaning.englishShort} />
        </div>
        {meaning.englishFull !== meaning.englishShort && (
          <div className="mt-1 text-sm text-gray-500">
            <ClickableEnglish text={meaning.englishFull} />
          </div>
        )}
      </div>

      {/* Example sentences */}
      {sentences.length > 0 && (
        <div className="px-6 pb-4">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
            Example Sentences
          </h3>
          <div className="space-y-2">
            {sentences.map((s) => (
              <div
                key={s.id}
                className="p-3 rounded bg-gray-50 hover:bg-gray-100 cursor-pointer"
                onClick={() => push({ type: 'sentence', id: s.id })}
              >
                <div className="text-lg">{s.chinese}</div>
                <div className="text-sm text-gray-500">{s.pinyinSandhi}</div>
                <div className="text-sm text-gray-600">
                  <ClickableEnglish text={s.english} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other meanings of the same headword */}
      {otherMeanings.length > 0 && (
        <div className="px-6 pb-4">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
            Other Meanings of "{meaning.headword}"
          </h3>
          <div className="space-y-1">
            {otherMeanings.map((m) => (
              <button
                key={m.id}
                onClick={() => push({ type: 'meaning', id: m.id })}
                className="block w-full text-left p-2 rounded hover:bg-blue-50"
              >
                <span className="text-sm text-gray-500">{m.pinyin}</span>
                <span className="ml-2">{m.englishShort}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Character breakdown */}
      {charBreakdown.length > 0 && (
        <div className="px-6 pb-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
            Character Breakdown
          </h3>
          <div className="flex gap-4 justify-center">
            {charBreakdown.map((item) => (
              <button
                key={item.childMeaning.id}
                onClick={() =>
                  push({ type: 'meaning', id: item.childMeaning.id })
                }
                className="flex flex-col items-center p-3 rounded hover:bg-blue-50"
              >
                <span className="text-3xl">{item.childMeaning.headword}</span>
                <span className="text-xs text-gray-500">
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

/** Sentence view inside the exploration modal */
function SentenceContent() {
  const { current } = useNavigationStore();
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);

  const entry = current();

  useEffect(() => {
    if (!entry || entry.type !== 'sentence') {
      setSentence(null);
      return;
    }

    let cancelled = false;
    async function load() {
      const s = await db.sentences.get(entry!.id);
      if (cancelled || !s) return;
      setSentence(s);

      const toks = await getTokensForSentence(s.id);
      if (!cancelled) setTokens(toks);
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
          className="text-sm text-gray-500"
        />
        <div className="text-base text-gray-700 mt-1">
          <ClickableEnglish text={sentence.english} />
        </div>
        <AudioButton text={sentence.chinese} className="mt-2" />
      </div>
    </div>
  );
}

export function MeaningCard() {
  const { isOpen, current, goBack, goForward, canGoBack, canGoForward, close } =
    useNavigationStore();
  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);

  const entry = current();

  // Advance tutorial when meaning card first opens during step 3
  useEffect(() => {
    if (isOpen && entry && tutorialStep === 3) {
      advanceTutorial();
    }
  }, [isOpen, entry, tutorialStep, advanceTutorial]);

  if (!isOpen || !entry) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header with navigation */}
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white rounded-t-lg z-10">
          <div className="flex gap-2">
            <button
              onClick={goBack}
              disabled={!canGoBack()}
              className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30"
            >
              &larr;
            </button>
            <button
              onClick={goForward}
              disabled={!canGoForward()}
              className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30"
            >
              &rarr;
            </button>
          </div>
          <div className="text-xs text-gray-400">
            {entry.type === 'meaning' && 'Meaning'}
            {entry.type === 'sentence' && 'Sentence'}
            {entry.type === 'pinyin' && 'Pinyin'}
            {entry.type === 'english' && 'English'}
          </div>
          <button
            onClick={close}
            className="px-2 py-1 rounded hover:bg-gray-100"
          >
            &times;
          </button>
        </div>

        {/* Tutorial hint */}
        <div className="px-4 pt-2">
          <TutorialBanner visibleAt={4}>
            This is the <strong>meaning explorer</strong>. You can click any character,
            pinyin syllable, or English word to navigate deeper. Use the arrows to go
            back and forward. Try clicking around, then close this to continue!
            <div className="mt-2 text-xs text-gray-500">
              When you add your own sentences later, every character and word will be
              linked here automatically.
            </div>
          </TutorialBanner>
        </div>

        {/* Content based on entry type */}
        {entry.type === 'meaning' && <MeaningContent />}
        {entry.type === 'sentence' && <SentenceContent />}
        {entry.type === 'pinyin' && <PinyinCard />}
        {entry.type === 'english' && <EnglishCard />}
      </div>
    </div>
  );
}
