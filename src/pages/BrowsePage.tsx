import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../db/db';
import type { Sentence } from '../db/schema';
import { getTokensForSentence, updateSentenceTags, getAllTags } from '../services/ingestion';
import { TokenSpan } from '../components/TokenSpan';
import { PinyinDisplay } from '../components/PinyinDisplay';
import { MeaningCard } from '../components/MeaningCard';
import { ClickableEnglish } from '../components/ClickableEnglish';
import { TagInput } from '../components/TagInput';
import { useNavigationStore } from '../stores/navigationStore';
import { useTutorialStore } from '../stores/tutorialStore';
import { TutorialBanner } from '../components/TutorialBanner';
import type { SentenceToken, Meaning } from '../db/schema';

type TokenWithMeaning = SentenceToken & { meaning: Meaning };

export function BrowsePage() {
  const navigate = useNavigate();
  const { open } = useNavigationStore();
  const tutorialStep = useTutorialStore((s) => s.step);
  const advanceTutorial = useTutorialStore((s) => s.advance);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenWithMeaning[]>([]);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    db.sentences.orderBy('createdAt').reverse().toArray().then(setSentences);
    getAllTags().then(setAllTags);
  }, []);

  // Find the 花 sentence for tutorial highlighting
  const huaSentence = sentences.find((s) => s.chinese === '她花了很多钱买花。');

  const handleTagsChange = async (sentenceId: string, newTags: string[]) => {
    await updateSentenceTags(sentenceId, newTags);
    setSentences((prev) =>
      prev.map((s) => (s.id === sentenceId ? { ...s, tags: newTags } : s))
    );
    getAllTags().then(setAllTags);
  };

  const toggleFilterTag = (tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const filteredSentences = filterTags.length > 0
    ? sentences.filter((s) => filterTags.some((t) => s.tags?.includes(t)))
    : sentences;

  const handleExpand = async (sentenceId: string) => {
    if (expandedId === sentenceId) {
      setExpandedId(null);
      return;
    }
    if (tutorialStep === 3) advanceTutorial();
    setExpandedId(sentenceId);
    const t = await getTokensForSentence(sentenceId);
    setTokens(t);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Browse Sentences</h1>
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
        >
          &larr; Back
        </button>
      </div>

      <TutorialBanner visibleAt={3}>
        Here are your sentences. Click on <strong>"她花了很多钱买花。"</strong> to expand it
        and see the word-by-word breakdown. This is the sentence where 花 has two different
        meanings!
      </TutorialBanner>

      <TutorialBanner visibleAt={4}>
        Now <strong>click on one of the 花 characters</strong> (the large Chinese text) to
        open the meaning explorer. You'll see that 花 has two separate meaning entries &mdash;
        "to spend" and "flower." You can also click on the <strong>shì</strong> pinyin to see
        all characters that share that sound.
      </TutorialBanner>

      {allTags.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              filterTags.length > 0
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Filter by tag{filterTags.length > 0 ? ` (${filterTags.length})` : ''} {showFilter ? '\u25B2' : '\u25BC'}
          </button>
          {showFilter && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <button
                onClick={() => setFilterTags([])}
                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                  filterTags.length === 0
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleFilterTag(tag)}
                  className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                    filterTags.includes(tag)
                      ? 'bg-blue-500 text-white'
                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sentences.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          No sentences yet.{' '}
          <button
            onClick={() => navigate('/add')}
            className="text-blue-500 underline"
          >
            Add one
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSentences.map((s) => {
            const isTutorialTarget = tutorialStep === 3 && huaSentence && s.id === huaSentence.id;

            return (
              <div
                key={s.id}
                className={`bg-white rounded-lg shadow ${
                  isTutorialTarget ? 'ring-2 ring-blue-300 ring-offset-2' : ''
                }`}
              >
                <button
                  onClick={() => handleExpand(s.id)}
                  className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="text-lg">{s.chinese}</div>
                  <div className="text-sm text-gray-500">
                    <ClickableEnglish text={s.english} />
                  </div>
                </button>

                {expandedId === s.id && (
                  <div className="px-4 pb-4 pt-0 border-t">
                    <div className="text-sm text-gray-500 mb-2">
                      <PinyinDisplay
                        pinyin={s.pinyinSandhi}
                        basePinyin={s.pinyin}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
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
                    <div className="mt-3 flex items-center justify-between">
                      <button
                        onClick={() => open({ type: 'sentence', id: s.id })}
                        className="text-sm text-blue-500 hover:text-blue-700 transition-colors"
                      >
                        View sentence card &rarr;
                      </button>
                      {editingTagsId !== s.id ? (
                        <button
                          onClick={() => setEditingTagsId(s.id)}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {s.tags && s.tags.length > 0 ? 'edit tags' : '+ tag'}
                        </button>
                      ) : null}
                    </div>
                    {editingTagsId === s.id && (
                      <div className="mt-2">
                        <TagInput
                          tags={s.tags || []}
                          onChange={(newTags) => handleTagsChange(s.id, newTags)}
                          compact
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <MeaningCard />
    </div>
  );
}
