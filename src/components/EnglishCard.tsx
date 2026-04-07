import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import * as repo from '../db/repo';
import { lookupByEnglish, type DictEntry } from '../lib/cedict';
import type { Meaning } from '../db/schema';

function getStemmedForms(word: string): Set<string> {
  const forms = new Set<string>([word]);
  if (word.endsWith('ies')) forms.add(word.slice(0, -3) + 'y');
  if (word.endsWith('ves')) forms.add(word.slice(0, -3) + 'fe');
  if (word.endsWith('ves')) forms.add(word.slice(0, -3) + 'f');
  if (word.endsWith('ses')) forms.add(word.slice(0, -2));
  if (word.endsWith('es')) forms.add(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) forms.add(word.slice(0, -1));
  if (word.endsWith('ed')) forms.add(word.slice(0, -2));
  if (word.endsWith('ed')) forms.add(word.slice(0, -1));
  if (word.endsWith('ing')) forms.add(word.slice(0, -3));
  if (word.endsWith('ing')) forms.add(word.slice(0, -3) + 'e');
  if (word.endsWith('ly')) forms.add(word.slice(0, -2));
  if (word.endsWith('er')) forms.add(word.slice(0, -2));
  if (word.endsWith('er')) forms.add(word.slice(0, -1));
  if (word.endsWith('est')) forms.add(word.slice(0, -3));
  if (word.endsWith('est')) forms.add(word.slice(0, -2));
  forms.add('to ' + word);
  for (const f of [...forms]) {
    if (!f.startsWith('to ')) forms.add('to ' + f);
  }
  return forms;
}

export function EnglishCard() {
  const { current, push } = useNavigationStore();
  const [meanings, setMeanings] = useState<Meaning[]>([]);
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const entry = current();

  useEffect(() => {
    if (!entry || entry.type !== 'english') {
      setMeanings([]);
      setDictEntries([]);
      return;
    }

    let cancelled = false;
    const word = entry.id.toLowerCase();
    const forms = getStemmedForms(word);

    async function load() {
      const all = await repo.getAllMeanings();
      const pattern = [...forms].map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const re = new RegExp(`\\b(?:${pattern})\\b`, 'i');
      const results = all.filter(
        (m) => re.test(m.englishShort) || re.test(m.englishFull)
      );
      results.sort((a, b) => {
        const aExact = forms.has(a.englishShort.toLowerCase()) ? 0 : 1;
        const bExact = forms.has(b.englishShort.toLowerCase()) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.headword.length - b.headword.length;
      });

      if (cancelled) return;
      setMeanings(results);

      if (results.length === 0) {
        const headwordsInDb = new Set(all.map((m) => m.headword));
        const dictResults = lookupByEnglish([...forms]);
        const seen = new Set<string>();
        const unique = dictResults.filter((d) => {
          if (seen.has(d.simplified) || headwordsInDb.has(d.simplified)) return false;
          seen.add(d.simplified);
          return true;
        });
        if (!cancelled) setDictEntries(unique);
      } else {
        if (!cancelled) setDictEntries([]);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry || entry.type !== 'english') return null;

  const word = entry.id;
  const totalCount = meanings.length + dictEntries.length;

  return (
    <>
      <div className="p-6 text-center">
        <div className="text-3xl font-medium">{word}</div>
        <div className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {totalCount} Chinese meaning{totalCount !== 1 ? 's' : ''}
        </div>
      </div>

      {meanings.length > 0 && (
        <div className="px-6 pb-4">
          <h3 className="text-sm font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Your Vocabulary
          </h3>
          <div className="space-y-2">
            {meanings.map((m) => (
              <button
                key={m.id}
                onClick={() => push({ type: 'meaning', id: m.id })}
                className="w-full text-left p-3 rounded-lg transition-colors surface-hover
                  flex items-center gap-3"
                style={{ border: '1px solid var(--border)' }}
              >
                <span className="text-3xl">{m.headword}</span>
                <div className="flex-1">
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{m.pinyin}</div>
                  <div className="text-sm">
                    {m.englishShort}
                    {m.partOfSpeech && (
                      <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>({m.partOfSpeech})</span>
                    )}
                  </div>
                  {m.englishFull !== m.englishShort && (
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{m.englishFull}</div>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{m.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {dictEntries.length > 0 && (
        <div className="px-6 pb-6">
          <h3 className="text-sm font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Dictionary (CEDICT)
          </h3>
          <div className="space-y-2">
            {dictEntries.map((d, i) => (
              <div
                key={i}
                className="w-full text-left p-3 rounded-lg flex items-center gap-3"
                style={{ border: '1px dashed var(--border)' }}
              >
                <span className="text-3xl">{d.simplified}</span>
                <div className="flex-1">
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{d.pinyin}</div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {d.english.replace(/\//g, ' / ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalCount === 0 && (
        <div className="px-6 pb-6 text-center" style={{ color: 'var(--text-tertiary)' }}>
          No Chinese meanings found for "{word}"
        </div>
      )}
    </>
  );
}
