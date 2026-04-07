import { useState } from 'react';
import { numericToDiacritic } from '../services/toneSandhi';
import { applyToneSandhi } from '../services/toneSandhi';
import { TUTORIAL_SENTENCES } from '../data/tutorialSentences';

interface TokenDisplayProps {
  surfaceForm: string;
  pinyinNumeric: string;
  sandhiNumeric?: string;
}

function TokenStack({ surfaceForm, pinyinNumeric, sandhiNumeric }: TokenDisplayProps) {
  const pinyin = numericToDiacritic(pinyinNumeric);
  const sandhi = sandhiNumeric ? numericToDiacritic(sandhiNumeric) : null;
  const differs = sandhi && sandhi !== pinyin;

  return (
    <span className="inline-flex flex-col items-center px-1">
      <span className="text-xl">{surfaceForm}</span>
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{pinyin}</span>
      {differs && (
        <span className="text-xs font-medium" style={{ color: 'var(--sandhi-underline)' }}>{sandhi}</span>
      )}
    </span>
  );
}

function computeSandhiForTokens(tokens: { pinyinNumeric: string }[]): string[] {
  return applyToneSandhi(tokens.map((t) => t.pinyinNumeric));
}

function ExampleSentenceDisplay({ sentenceIndex }: { sentenceIndex: number }) {
  const sentence = TUTORIAL_SENTENCES[sentenceIndex];
  const sandhiPinyins = computeSandhiForTokens(sentence.tokens);

  return (
    <div className="rounded-lg p-4" style={{ border: '1px solid var(--border)' }}>
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
      <div className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>{sentence.english}</div>
    </div>
  );
}

export function IntroModal({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const totalPages = 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl max-w-lg w-full mx-3 sm:mx-4 max-h-[90vh] overflow-y-auto surface">
        {page === 0 && (
          <div className="p-5 sm:p-8">
            <h2 className="text-2xl font-bold mb-4">Welcome to Mandao</h2>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Mandao is built around one idea: <strong>learn Mandarin through whole sentences,
              not isolated vocabulary.</strong>
            </p>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Each sentence you add gets broken down into its component words and characters,
              building a personal knowledge graph that connects everything you learn. Under the
              hood, <strong>FSRS</strong> (Free Spaced Repetition Scheduler) shows you cards at
              the optimal time for long-term retention.
            </p>
            <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>
              Mandarin has three layers of complexity that make sentence-level study essential:
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--accent-subtle)' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}>1</div>
                <div>
                  <div className="font-medium text-sm">Tone Sandhi</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Written pinyin doesn't always match how you say it. Tones shift based on
                    neighboring tones. Mandao stores both so you know what to actually say.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--success-subtle)' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'var(--success)', color: 'var(--text-inverted)' }}>2</div>
                <div>
                  <div className="font-medium text-sm">One Character, Many Meanings</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    A single character can have completely different meanings depending on
                    context. Mandao tracks each meaning separately.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: `color-mix(in srgb, #8b5cf6 10%, var(--bg-surface))` }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: '#8b5cf6', color: '#fff' }}>3</div>
                <div>
                  <div className="font-medium text-sm">One Sound, Many Characters</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    The same pinyin syllable can map to dozens of different characters.
                    Only context and written characters distinguish them.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {page === 1 && (
          <div className="p-5 sm:p-8">
            <h2 className="text-2xl font-bold mb-2">How Sentences Look</h2>
            <p className="text-sm mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Each sentence displays three layers of information:
            </p>

            <div className="mb-4 p-3 rounded-lg text-sm space-y-1 inset" style={{ color: 'var(--text-secondary)' }}>
              <div><strong>Top:</strong> Chinese characters</div>
              <div><strong>Middle:</strong> Dictionary pinyin (base tones)</div>
              <div><strong>Bottom:</strong> Spoken pinyin &mdash; syllables that change due to tone sandhi appear in the text color (not tone-colored) so you can spot them at a glance</div>
            </div>

            <div className="space-y-4">
              <div>
                <ExampleSentenceDisplay sentenceIndex={0} />
                <div className="text-xs rounded p-2 mt-1 inset" style={{ color: 'var(--text-secondary)' }}>
                  <strong>Same character, different meanings:</strong> 花 (huā) appears
                  twice &mdash; first as "to spend," then as "flower."
                </div>
              </div>

              <div>
                <ExampleSentenceDisplay sentenceIndex={1} />
                <div className="text-xs rounded p-2 mt-1 inset" style={{ color: 'var(--text-secondary)' }}>
                  <strong>Tone sandhi:</strong> 你好 is nǐ hǎo (3+3) in the dictionary but
                  spoken as ní hǎo (2+3). In the sandhi line, ní loses its tone color to show the change.
                </div>
              </div>

              <div>
                <ExampleSentenceDisplay sentenceIndex={2} />
                <div className="text-xs rounded p-2 mt-1 space-y-1 inset" style={{ color: 'var(--text-secondary)' }}>
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

        {page === 2 && (
          <div className="p-5 sm:p-8">
            <h2 className="text-2xl font-bold mb-4">Let's Add Your First Sentence</h2>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              We'll walk you through adding the first example sentence step by step.
              This is the same process you'll use for every sentence you add to your deck.
            </p>
            <div className="p-4 rounded-lg mb-4" style={{ background: 'var(--accent-subtle)' }}>
              <div className="text-lg font-medium mb-1">她花了很多钱买花。</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>She spent a lot of money buying flowers.</div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              After that, we'll automatically add the other two example sentences and
              show you how to browse and explore the meaning graph.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="px-5 sm:px-8 pb-6 flex items-center justify-between">
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {page + 1} / {totalPages}
          </div>
          <div className="flex gap-3">
            {page > 0 && (
              <button
                onClick={() => setPage(page - 1)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                Back
              </button>
            )}
            {page < totalPages - 1 ? (
              <button
                onClick={() => setPage(page + 1)}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
              >
                Next
              </button>
            ) : (
              <button
                onClick={onDone}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
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
