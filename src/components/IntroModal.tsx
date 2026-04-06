import { useState } from 'react';
import { ingestSentence, type SentenceInput } from '../services/ingestion';

// ============================================================
// Pre-built example sentences with full token data
// ============================================================

const EXAMPLE_SENTENCES: SentenceInput[] = [
  {
    chinese: '你好！你是哪国人？',
    english: 'Hello! What country are you from?',
    source: 'tutorial',
    tokens: [
      {
        surfaceForm: '你',
        pinyinNumeric: 'ni3',
        english: 'you',
        partOfSpeech: 'pronoun',
      },
      {
        surfaceForm: '好',
        pinyinNumeric: 'hao3',
        english: 'good',
        partOfSpeech: 'adj',
      },
      {
        surfaceForm: '你',
        pinyinNumeric: 'ni3',
        english: 'you',
        partOfSpeech: 'pronoun',
      },
      {
        surfaceForm: '是',
        pinyinNumeric: 'shi4',
        english: 'to be',
        partOfSpeech: 'verb',
      },
      {
        surfaceForm: '哪',
        pinyinNumeric: 'na3',
        english: 'which',
        partOfSpeech: 'pronoun',
      },
      {
        surfaceForm: '国',
        pinyinNumeric: 'guo2',
        english: 'country',
        partOfSpeech: 'noun',
      },
      {
        surfaceForm: '人',
        pinyinNumeric: 'ren2',
        english: 'person',
        partOfSpeech: 'noun',
      },
    ],
  },
  {
    chinese: '她花了很多钱买花。',
    english: 'She spent a lot of money buying flowers.',
    source: 'tutorial',
    tokens: [
      {
        surfaceForm: '她',
        pinyinNumeric: 'ta1',
        english: 'she',
        partOfSpeech: 'pronoun',
      },
      {
        surfaceForm: '花',
        pinyinNumeric: 'hua1',
        english: 'to spend',
        partOfSpeech: 'verb',
      },
      {
        surfaceForm: '了',
        pinyinNumeric: 'le5',
        english: 'completed action',
        partOfSpeech: 'particle',
      },
      {
        surfaceForm: '很',
        pinyinNumeric: 'hen3',
        english: 'very',
        partOfSpeech: 'adv',
      },
      {
        surfaceForm: '多',
        pinyinNumeric: 'duo1',
        english: 'many',
        partOfSpeech: 'adj',
      },
      {
        surfaceForm: '钱',
        pinyinNumeric: 'qian2',
        english: 'money',
        partOfSpeech: 'noun',
      },
      {
        surfaceForm: '买',
        pinyinNumeric: 'mai3',
        english: 'to buy',
        partOfSpeech: 'verb',
      },
      {
        surfaceForm: '花',
        pinyinNumeric: 'hua1',
        english: 'flower',
        partOfSpeech: 'noun',
      },
    ],
  },
  {
    chinese: '这件事不是他做的。',
    english: 'This matter was not something he did.',
    source: 'tutorial',
    tokens: [
      {
        surfaceForm: '这',
        pinyinNumeric: 'zhe4',
        english: 'this',
        partOfSpeech: 'pronoun',
      },
      {
        surfaceForm: '件',
        pinyinNumeric: 'jian4',
        english: 'measure word for matters',
        partOfSpeech: 'measure',
      },
      {
        surfaceForm: '事',
        pinyinNumeric: 'shi4',
        english: 'matter; affair',
        partOfSpeech: 'noun',
      },
      {
        surfaceForm: '不',
        pinyinNumeric: 'bu4',
        english: 'not',
        partOfSpeech: 'adv',
      },
      {
        surfaceForm: '是',
        pinyinNumeric: 'shi4',
        english: 'to be',
        partOfSpeech: 'verb',
      },
      {
        surfaceForm: '他',
        pinyinNumeric: 'ta1',
        english: 'he',
        partOfSpeech: 'pronoun',
      },
      {
        surfaceForm: '做',
        pinyinNumeric: 'zuo4',
        english: 'to do',
        partOfSpeech: 'verb',
      },
      {
        surfaceForm: '的',
        pinyinNumeric: 'de5',
        english: 'structural particle',
        partOfSpeech: 'particle',
      },
    ],
  },
];

// ============================================================
// Component
// ============================================================

export function IntroModal({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const totalPages = 4;

  const handleSeedAndContinue = async () => {
    setSeeding(true);
    for (const sentence of EXAMPLE_SENTENCES) {
      try {
        await ingestSentence(sentence);
      } catch {
        // skip duplicates if re-run
      }
    }
    setSeeded(true);
    setSeeding(false);
  };

  const handleFinish = () => {
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Page 0: Welcome */}
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
            <p className="text-gray-700">
              You review each sentence three ways: English-to-Chinese, Chinese-to-English, and
              Pinyin-to-meaning &mdash; building both recognition and recall.
            </p>
          </div>
        )}

        {/* Page 1: Why Mandarin is hard */}
        {page === 1 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-2">Why This Matters</h2>
            <p className="text-gray-500 text-sm mb-5">
              Three layers of complexity that Mandao helps you navigate
            </p>

            <div className="space-y-2 mb-4">
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-sm font-bold text-blue-700">1</div>
                <div>
                  <div className="font-medium text-sm">Tone Sandhi</div>
                  <div className="text-xs text-gray-600">
                    The written pinyin doesn't always match how you say it. For example,
                    你好 is written n&#x01D0; h&#x01CE;o (3-3) but spoken n&#x00ED; h&#x01CE;o (2-3).
                    Mandao stores both so you know what to actually say.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-sm font-bold text-green-700">2</div>
                <div>
                  <div className="font-medium text-sm">One Character, Many Meanings</div>
                  <div className="text-xs text-gray-600">
                    花 (hu&#x0101;) can mean "to spend" or "flower" depending on context.
                    Mandao tracks each meaning separately so you can see them all.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-sm font-bold text-purple-700">3</div>
                <div>
                  <div className="font-medium text-sm">One Sound, Many Characters</div>
                  <div className="text-xs text-gray-600">
                    The sound sh&#x00EC; maps to 事 (matter), 是 (to be), 市 (city), 室 (room),
                    and dozens more. Only context and characters distinguish them.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page 2: The 3 example sentences */}
        {page === 2 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-1">Example Sentences</h2>
            <p className="text-gray-500 text-sm mb-5">
              We'll add these 3 sentences to your deck so you can explore them
            </p>

            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <div className="text-xl mb-1">你好！你是哪国人？</div>
                <div className="text-sm text-gray-700 mb-2">Hello! What country are you from?</div>
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                  <strong>Tone sandhi:</strong> 你好 is written nǐ hǎo (3rd + 3rd) but spoken
                  as ní hǎo (2nd + 3rd). When two 3rd tones appear in a row, the first shifts
                  to 2nd tone.
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <div className="text-xl mb-1">她花了很多钱买花。</div>
                <div className="text-sm text-gray-700 mb-2">She spent a lot of money buying flowers.</div>
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                  <strong>Same character, different meanings:</strong> 花 appears twice &mdash;
                  first as "to spend," then as "flower." Same pronunciation, completely
                  different meanings determined by context.
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <div className="text-xl mb-1">这件事不是他做的。</div>
                <div className="text-sm text-gray-700 mb-2">This matter was not something he did.</div>
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 space-y-1">
                  <div>
                    <strong>Same sound, different characters:</strong> shì maps to both
                    事 (matter) and 是 (to be) in the same sentence.
                  </div>
                  <div>
                    <strong>Tone sandhi:</strong> 不 is normally bù (4th) but becomes
                    bú (2nd) before another 4th tone &mdash; here before 是 (shì).
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page 3: Seed sentences + start tutorial */}
        {page === 3 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-4">Let's Explore</h2>
            {!seeded ? (
              <>
                <p className="text-gray-700 mb-4">
                  We'll add those 3 example sentences to your deck now. Then we'll walk you
                  through how to browse them, click on characters to explore their meanings,
                  and see how the knowledge graph works.
                </p>
                <button
                  onClick={handleSeedAndContinue}
                  disabled={seeding}
                  className="w-full py-3 rounded-lg bg-blue-500 text-white font-medium
                    hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {seeding ? 'Adding sentences...' : 'Add Example Sentences'}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4 text-green-700 bg-green-50 p-3 rounded-lg">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-medium">3 sentences added to your deck!</span>
                </div>
                <p className="text-gray-700 mb-4">
                  Now let's explore them. We'll guide you through the main features step by step.
                </p>
              </>
            )}
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
              seeded && (
                <button
                  onClick={handleFinish}
                  className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white
                    hover:bg-blue-600 transition-colors"
                >
                  Start Exploring
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
