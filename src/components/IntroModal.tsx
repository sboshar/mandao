import { useState } from 'react';
import { numericToDiacritic } from '../services/toneSandhi';
import { applyToneSandhi } from '../services/toneSandhi';
import { TUTORIAL_SENTENCES } from '../data/tutorialSentences';

// ============================================================
// Token display component — character / pinyin / sandhi stacked
// ============================================================

interface TokenDisplayProps {
  surfaceForm: string;
  pinyinNumeric: string;
  /** If provided and differs from pinyin, shown as sandhi row */
  sandhiNumeric?: string;
  highlight?: boolean;
}

function TokenStack({ surfaceForm, pinyinNumeric, sandhiNumeric, highlight }: TokenDisplayProps) {
  const pinyin = numericToDiacritic(pinyinNumeric);
  const sandhi = sandhiNumeric ? numericToDiacritic(sandhiNumeric) : null;
  const differs = sandhi && sandhi !== pinyin;

  return (
    <span className={`inline-flex flex-col items-center px-1 ${highlight ? 'bg-yellow-100 rounded' : ''}`}>
      <span className="text-xl">{surfaceForm}</span>
      <span className="text-xs text-gray-500">{pinyin}</span>
      {differs && (
        <span className="text-xs text-orange-500 font-medium">{sandhi}</span>
      )}
    </span>
  );
}

/** Compute sandhi for a sentence's tokens and return per-token sandhi pinyinNumeric */
function computeSandhiForTokens(tokens: { pinyinNumeric: string }[]): string[] {
  const allSyllables = tokens.map((t) => t.pinyinNumeric);
  const sandhiSyllables = applyToneSandhi(allSyllables);
  return sandhiSyllables;
}

// ============================================================
// Example sentence display with stacked format
// ============================================================

function ExampleSentenceDisplay({ sentenceIndex }: { sentenceIndex: number }) {
  const sentence = TUTORIAL_SENTENCES[sentenceIndex];
  const sandhiPinyins = computeSandhiForTokens(sentence.tokens);

  return (
    <div className="border rounded-lg p-4">
      {/* Stacked tokens */}
      <div className="flex flex-wrap justify-center gap-0.5 mb-2">
        {sentence.tokens.map((t, i) => (
          <TokenStack
            key={i}
            surfaceForm={t.surfaceForm}
            pinyinNumeric={t.pinyinNumeric}
            sandhiNumeric={sandhiPinyins[i] !== t.pinyinNumeric ? sandhiPinyins[i] : undefined}
          />
        ))}
      </div>
      <div className="text-sm text-gray-700 text-center">{sentence.english}</div>
    </div>
  );
}

// ============================================================
// Main modal
// ============================================================

export function IntroModal({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const totalPages = 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Page 0: Welcome + theory */}
        {page === 0 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-4">Welcome to Mandao</h2>
            <p className="text-gray-700 mb-4">
              Mandao is built around one idea: <strong>learn Mandarin through whole sentences,
              not isolated vocabulary.</strong>
            </p>
            <p className="text-gray-700 mb-4">
              Each sentence you add gets broken down into its component words and characters,
              building a personal knowledge graph that connects everything you learn. Under the
              hood, <strong>FSRS</strong> (Free Spaced Repetition Scheduler) shows you cards at
              the optimal time for long-term retention.
            </p>
            <p className="text-gray-700 mb-2">
              Mandarin has three layers of complexity that make sentence-level study essential:
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-xs font-bold text-blue-700">1</div>
                <div>
                  <div className="font-medium text-sm">Tone Sandhi</div>
                  <div className="text-xs text-gray-600">
                    Written pinyin doesn't always match how you say it. Tones shift based on
                    neighboring tones. Mandao stores both so you know what to actually say.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-xs font-bold text-green-700">2</div>
                <div>
                  <div className="font-medium text-sm">One Character, Many Meanings</div>
                  <div className="text-xs text-gray-600">
                    A single character can have completely different meanings depending on
                    context. Mandao tracks each meaning separately.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs font-bold text-purple-700">3</div>
                <div>
                  <div className="font-medium text-sm">One Sound, Many Characters</div>
                  <div className="text-xs text-gray-600">
                    The same pinyin syllable can map to dozens of different characters.
                    Only context and written characters distinguish them.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page 1: Example sentences in stacked format */}
        {page === 1 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-2">How Sentences Look</h2>
            <p className="text-gray-500 text-sm mb-3">
              Each sentence displays three layers of information:
            </p>

            {/* Format explanation */}
            <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 space-y-1">
              <div><strong>Top:</strong> Chinese characters</div>
              <div><strong>Middle:</strong> Dictionary pinyin (base tones)</div>
              <div><strong>Bottom (orange):</strong> Spoken pinyin where tone sandhi changes the pronunciation</div>
            </div>

            <div className="space-y-4">
              {/* Sentence 0: 她花了很多钱买花 — character with multiple meanings */}
              <div>
                <ExampleSentenceDisplay sentenceIndex={0} />
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 mt-1">
                  <strong>Same character, different meanings:</strong> 花 (huā) appears
                  twice &mdash; first as "to spend," then as "flower."
                </div>
              </div>

              {/* Sentence 1: 你好！你是哪国人？ — tone sandhi */}
              <div>
                <ExampleSentenceDisplay sentenceIndex={1} />
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 mt-1">
                  <strong>Tone sandhi:</strong> 你好 is nǐ hǎo (3+3) in the dictionary but
                  spoken as ní hǎo (2+3). The orange row shows what you actually say.
                </div>
              </div>

              {/* Sentence 2: 这件事不是他做的 — same sound, different chars + sandhi */}
              <div>
                <ExampleSentenceDisplay sentenceIndex={2} />
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 mt-1 space-y-1">
                  <div>
                    <strong>Same sound, different characters:</strong> shì maps to
                    both 事 (matter) and 是 (to be).
                  </div>
                  <div>
                    <strong>Tone sandhi:</strong> 不 is bù (4th) but becomes bú (2nd) before
                    another 4th tone — here before 是 (shì).
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page 2: Let's add a sentence */}
        {page === 2 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-4">Let's Add Your First Sentence</h2>
            <p className="text-gray-700 mb-4">
              We'll walk you through adding the first example sentence step by step.
              This is the same process you'll use for every sentence you add to your deck.
            </p>
            <div className="p-4 bg-blue-50 rounded-lg mb-4">
              <div className="text-lg font-medium mb-1">她花了很多钱买花。</div>
              <div className="text-sm text-gray-600">She spent a lot of money buying flowers.</div>
            </div>
            <p className="text-gray-600 text-sm">
              After that, we'll automatically add the other two example sentences and
              show you how to browse and explore the meaning graph.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="px-8 pb-6 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {page + 1} / {totalPages}
          </div>
          <div className="flex gap-3">
            {page > 0 && (
              <button
                onClick={() => setPage(page - 1)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600
                  hover:bg-gray-100 transition-colors"
              >
                Back
              </button>
            )}
            {page < totalPages - 1 ? (
              <button
                onClick={() => setPage(page + 1)}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white
                  hover:bg-blue-600 transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                onClick={onDone}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white
                  hover:bg-blue-600 transition-colors"
              >
                Start Adding
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
