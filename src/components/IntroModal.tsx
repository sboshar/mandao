import { useState } from 'react';

const INTRO_SEEN_KEY = 'mandao_intro_seen';

export function useIntroSeen() {
  const [seen, setSeen] = useState(() => localStorage.getItem(INTRO_SEEN_KEY) === '1');
  const markSeen = () => {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
    setSeen(true);
  };
  return { seen, markSeen };
}

interface ExampleSentence {
  chinese: string;
  pinyinWritten: string;
  pinyinSpoken: string;
  english: string;
  notes: string[];
}

const examples: ExampleSentence[] = [
  {
    chinese: '你好！你是哪国人？',
    pinyinWritten: 'nǐ hǎo! nǐ shì nǎ guó rén?',
    pinyinSpoken: 'ní hǎo! nǐ shì nǎ guó rén?',
    english: 'Hello! What country are you from?',
    notes: [
      'Tone sandhi: 你好 is written nǐ hǎo (3-3) but spoken as ní hǎo (2-3) \u2014 when two third tones appear in a row, the first shifts to second tone.',
    ],
  },
  {
    chinese: '她花了很多钱买花。',
    pinyinWritten: 'tā huā le hěn duō qián mǎi huā.',
    pinyinSpoken: 'tā huā le hěn duō qián mǎi huā.',
    english: 'She spent a lot of money buying flowers.',
    notes: [
      'Same character, different meanings: 花 (hu\u0101) appears twice \u2014 first as the verb "to spend," then as the noun "flower." Context determines which meaning applies.',
    ],
  },
  {
    chinese: '这件事不是他做的。',
    pinyinWritten: 'zhè jiàn shì bù shì tā zuò de.',
    pinyinSpoken: 'zhè jiàn shì bú shì tā zuò de.',
    english: 'This matter was not something he did.',
    notes: [
      'Same pinyin, different meanings: shì maps to both 事 (matter/affair) and 是 (to be). Dozens of common characters share the sound shì \u2014 only context and characters distinguish them.',
      'Tone sandhi: 不 is normally bù (4th tone) but becomes bú (2nd tone) before another 4th tone \u2014 here before 是 (shì).',
    ],
  },
];

function ToneSpan({ tone, children }: { tone: number; children: React.ReactNode }) {
  const cls = tone >= 1 && tone <= 5 ? `tone-${tone}` : '';
  return <span className={`font-medium ${cls}`}>{children}</span>;
}

function PinyinComparison({ written, spoken }: { written: string; spoken: string }) {
  if (written === spoken) {
    return <div className="text-sm text-gray-600">{written}</div>;
  }
  return (
    <div className="text-sm space-y-0.5">
      <div>
        <span className="text-gray-400 w-16 inline-block">Written:</span>{' '}
        <span className="text-gray-500">{written}</span>
      </div>
      <div>
        <span className="text-gray-400 w-16 inline-block">Spoken:</span>{' '}
        <ToneSpan tone={2}>{spoken}</ToneSpan>
      </div>
    </div>
  );
}

export function IntroModal({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);
  const totalPages = 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {page === 0 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-4">Welcome to Mandao</h2>
            <p className="text-gray-700 mb-4">
              Mandao is built around one idea: <strong>learn Mandarin through whole sentences,
              not isolated vocabulary.</strong> Each sentence you add gets broken down into its
              component words, characters, and radicals, building a personal knowledge graph
              that connects everything you learn.
            </p>
            <p className="text-gray-700 mb-4">
              Under the hood, the app uses <strong>FSRS</strong> (Free Spaced Repetition Scheduler)
              to show you cards at the optimal time for long-term retention. You review each
              sentence in three modes: English-to-Chinese, Chinese-to-English, and Pinyin-to-meaning,
              so you build both recognition and recall.
            </p>
            <p className="text-gray-700">
              But before you start adding sentences, it helps to understand <em>why</em> Mandarin
              is uniquely challenging \u2014 and what this tool is designed to help with. The next
              pages show three real examples.
            </p>
          </div>
        )}

        {page === 1 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-2">Why Mandarin is Hard</h2>
            <p className="text-gray-500 text-sm mb-6">
              Three layers of complexity that Mandao helps you navigate
            </p>

            <div className="space-y-2 mb-4">
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-sm font-bold text-blue-700">1</div>
                <div>
                  <div className="font-medium text-sm">Tone Sandhi</div>
                  <div className="text-xs text-gray-600">The written pinyin doesn't always match how you actually say it. Tones shift depending on neighboring tones.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-sm font-bold text-green-700">2</div>
                <div>
                  <div className="font-medium text-sm">One Character, Many Meanings</div>
                  <div className="text-xs text-gray-600">A single character can have completely different meanings depending on context and surrounding words.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-sm font-bold text-purple-700">3</div>
                <div>
                  <div className="font-medium text-sm">One Sound, Many Characters</div>
                  <div className="text-xs text-gray-600">The same pinyin syllable can map to dozens of different characters, each with its own meaning.</div>
                </div>
              </div>
            </div>

            <p className="text-gray-600 text-sm">
              Mandao tracks all three: it stores both the dictionary pinyin and the spoken
              tone-sandhi pinyin, decomposes characters to show their meanings, and lets you
              explore all characters that share a sound. Here are three sentences that
              demonstrate these challenges:
            </p>
          </div>
        )}

        {page === 2 && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-1">Example Sentences</h2>
            <p className="text-gray-500 text-sm mb-5">
              Common sentences that show the complexity
            </p>

            <div className="space-y-5">
              {examples.map((ex, i) => (
                <div key={i} className="border rounded-lg p-4">
                  <div className="text-xl mb-1 font-medium">{ex.chinese}</div>
                  <PinyinComparison written={ex.pinyinWritten} spoken={ex.pinyinSpoken} />
                  <div className="text-sm text-gray-700 mt-1 mb-2">{ex.english}</div>
                  <div className="space-y-1">
                    {ex.notes.map((note, j) => (
                      <div key={j} className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Back
              </button>
            )}
            {page < totalPages - 1 ? (
              <button
                onClick={() => setPage(page + 1)}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
              >
                Get Started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
