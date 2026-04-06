import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { getMeaningsByPinyin } from '../services/ingestion';
import { numericStringToDiacritic } from '../services/toneSandhi';
import type { Meaning } from '../db/schema';

export function PinyinCard() {
  const { current, push } = useNavigationStore();
  const [meanings, setMeanings] = useState<Meaning[]>([]);
  const entry = current();

  useEffect(() => {
    if (!entry || entry.type !== 'pinyin') {
      setMeanings([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const results = await getMeaningsByPinyin(entry!.id);
      if (!cancelled) setMeanings(results);
    }

    load();
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry || entry.type !== 'pinyin' || meanings.length === 0) return null;

  const pinyinDisplay = numericStringToDiacritic(entry.id);

  const byHeadword = new Map<string, Meaning[]>();
  for (const m of meanings) {
    const existing = byHeadword.get(m.headword) || [];
    existing.push(m);
    byHeadword.set(m.headword, existing);
  }

  return (
    <>
      <div className="p-6 text-center">
        <div className="text-3xl font-medium">{pinyinDisplay}</div>
        <div className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {meanings.length} meaning{meanings.length !== 1 ? 's' : ''} in your app
        </div>
      </div>

      <div className="px-6 pb-6">
        <h3 className="text-sm font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Characters with this sound
        </h3>
        <div className="space-y-2">
          {[...byHeadword.entries()].map(([headword, hMeanings]) => (
            <div key={headword} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {hMeanings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => push({ type: 'meaning', id: m.id })}
                  className="w-full text-left p-3 transition-colors surface-hover
                    flex items-center gap-3"
                  style={{ borderBottom: '1px solid var(--border-light)' }}
                >
                  <span className="text-3xl">{m.headword}</span>
                  <div className="flex-1">
                    <div className="text-sm">
                      {m.englishShort}
                      {m.partOfSpeech && (
                        <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>({m.partOfSpeech})</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{m.type}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
