import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { db } from '../db/db';
import type { Meaning } from '../db/schema';

export function EnglishCard() {
  const { current, push } = useNavigationStore();
  const [meanings, setMeanings] = useState<Meaning[]>([]);
  const entry = current();

  useEffect(() => {
    if (!entry || entry.type !== 'english') {
      setMeanings([]);
      return;
    }

    let cancelled = false;
    const word = entry.id.toLowerCase();

    async function load() {
      const all = await db.meanings.toArray();
      // Build set of word forms to search: original + stemmed variants
      const forms = new Set<string>([word]);
      // Strip common English suffixes to find base forms
      if (word.endsWith('ies')) forms.add(word.slice(0, -3) + 'y');    // cities→city
      if (word.endsWith('ves')) forms.add(word.slice(0, -3) + 'fe');   // lives→life, wives→wife
      if (word.endsWith('ves')) forms.add(word.slice(0, -3) + 'f');    // wolves→wolf
      if (word.endsWith('ses')) forms.add(word.slice(0, -2));           // houses→house
      if (word.endsWith('es')) forms.add(word.slice(0, -2));            // goes→go
      if (word.endsWith('s') && !word.endsWith('ss')) forms.add(word.slice(0, -1)); // lives→live, cats→cat
      if (word.endsWith('ed')) forms.add(word.slice(0, -2));            // walked→walk
      if (word.endsWith('ed')) forms.add(word.slice(0, -1));            // lived→live
      if (word.endsWith('ing')) forms.add(word.slice(0, -3));           // walking→walk
      if (word.endsWith('ing')) forms.add(word.slice(0, -3) + 'e');     // living→live
      if (word.endsWith('ly')) forms.add(word.slice(0, -2));            // quickly→quick
      if (word.endsWith('er')) forms.add(word.slice(0, -2));            // bigger→big
      if (word.endsWith('er')) forms.add(word.slice(0, -1));            // nicer→nice
      if (word.endsWith('est')) forms.add(word.slice(0, -3));           // biggest→big
      if (word.endsWith('est')) forms.add(word.slice(0, -2));           // nicest→nice
      // Also add common inflections of the word so "live" matches "to live"
      forms.add('to ' + word);

      // Build a single regex that matches any form as a whole word
      const pattern = [...forms].map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const re = new RegExp(`\\b(?:${pattern})\\b`, 'i');
      const results = all.filter(
        (m) => re.test(m.englishShort) || re.test(m.englishFull)
      );
      // Sort: exact englishShort matches first, then by headword length
      results.sort((a, b) => {
        const aExact = forms.has(a.englishShort.toLowerCase()) ? 0 : 1;
        const bExact = forms.has(b.englishShort.toLowerCase()) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.headword.length - b.headword.length;
      });
      if (!cancelled) setMeanings(results);
    }

    load();
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry || entry.type !== 'english') return null;

  const word = entry.id;

  return (
    <>
      <div className="p-6 text-center">
        <div className="text-3xl font-medium">{word}</div>
        <div className="text-sm text-gray-400 mt-1">
          {meanings.length} Chinese meaning{meanings.length !== 1 ? 's' : ''}
        </div>
      </div>

      {meanings.length > 0 && (
        <div className="px-6 pb-6">
          <div className="space-y-2">
            {meanings.map((m) => (
              <button
                key={m.id}
                onClick={() => push({ type: 'meaning', id: m.id })}
                className="w-full text-left p-3 rounded-lg border hover:bg-blue-50
                  transition-colors flex items-center gap-3"
              >
                <span className="text-3xl">{m.headword}</span>
                <div className="flex-1">
                  <div className="text-sm text-gray-500">{m.pinyin}</div>
                  <div className="text-sm">
                    {m.englishShort}
                    {m.partOfSpeech && (
                      <span className="text-xs text-gray-400 ml-1">({m.partOfSpeech})</span>
                    )}
                  </div>
                  {m.englishFull !== m.englishShort && (
                    <div className="text-xs text-gray-400">{m.englishFull}</div>
                  )}
                </div>
                <span className="text-xs text-gray-300">{m.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {meanings.length === 0 && (
        <div className="px-6 pb-6 text-center text-gray-400">
          No Chinese meanings found for "{word}"
        </div>
      )}
    </>
  );
}
