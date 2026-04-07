import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../db/db';
import type { Sentence } from '../db/schema';
import { getTokensForSentence, updateSentenceTags, getAllTags, deleteSentence, deleteAllData } from '../services/ingestion';
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllInput, setDeleteAllInput] = useState('');

  useEffect(() => {
    db.sentences.orderBy('createdAt').reverse().toArray().then(setSentences);
    getAllTags().then(setAllTags);
  }, []);

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

  const handleDelete = async (sentenceId: string) => {
    await deleteSentence(sentenceId);
    setSentences((prev) => {
      const remaining = prev.filter((s) => s.id !== sentenceId);
      const tagSet = new Set<string>();
      for (const s of remaining) s.tags?.forEach((t) => tagSet.add(t));
      setAllTags([...tagSet].sort());
      return remaining;
    });
    setConfirmDeleteId(null);
    if (expandedId === sentenceId) setExpandedId(null);
  };

  const handleDeleteAll = async () => {
    await deleteAllData();
    setSentences([]);
    setExpandedId(null);
    setShowDeleteAll(false);
    setDeleteAllInput('');
    setAllTags([]);
    setFilterTags([]);
  };

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
        <div className="flex gap-2">
          {sentences.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              className="px-3 py-1 rounded text-sm transition-colors"
              style={{ background: 'var(--bg-inset)', color: 'var(--danger)' }}
            >
              Delete All
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1 rounded text-sm transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
        </div>
      </div>

      <TutorialBanner visibleAt={3}>
        Here are your sentences. Click on <strong>"她花了很多钱买花。"</strong> to expand it
        and see the word-by-word breakdown.
      </TutorialBanner>

      <TutorialBanner visibleAt={4}>
        Now <strong>click on one of the 花 characters</strong> to open the meaning explorer.
        You'll see that 花 has two separate meaning entries. You can also click on the
        <strong> shì</strong> pinyin to see all characters that share that sound.
      </TutorialBanner>

      {allTags.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="text-xs px-2.5 py-1 rounded-full transition-colors"
            style={filterTags.length > 0
              ? { background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }
              : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
            }
          >
            Filter by tag{filterTags.length > 0 ? ` (${filterTags.length})` : ''} {showFilter ? '\u25B2' : '\u25BC'}
          </button>
          {showFilter && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <button
                onClick={() => setFilterTags([])}
                className="px-2 py-0.5 text-xs rounded-full transition-colors"
                style={filterTags.length === 0
                  ? { background: 'var(--text-primary)', color: 'var(--bg-surface)' }
                  : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                }
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleFilterTag(tag)}
                  className="px-2 py-0.5 text-xs rounded-full transition-colors"
                  style={filterTags.includes(tag)
                    ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                    : { background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))', color: 'var(--accent)' }
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sentences.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>
          No sentences yet.{' '}
          <button
            onClick={() => navigate('/add')}
            style={{ color: 'var(--accent)' }}
            className="underline"
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
                className={`surface rounded-lg ${isTutorialTarget ? 'ring-2 ring-offset-2' : ''}`}
                style={isTutorialTarget ? { '--tw-ring-color': 'var(--accent)' } as React.CSSProperties : undefined}
              >
                <button
                  onClick={() => handleExpand(s.id)}
                  className="w-full text-left p-4 surface-hover transition-colors rounded-lg"
                >
                  <div className="text-lg">{s.chinese}</div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <ClickableEnglish text={s.english} />
                  </div>
                </button>

                {expandedId === s.id && (
                  <div className="px-4 pb-4 pt-0" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
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
                        className="text-sm transition-colors"
                        style={{ color: 'var(--accent)' }}
                      >
                        View sentence card &rarr;
                      </button>
                      <div className="flex items-center gap-3">
                        {confirmDeleteId === s.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: 'var(--danger)' }}>Delete this sentence?</span>
                            <button
                              onClick={() => handleDelete(s.id)}
                              className="text-xs px-2 py-0.5 rounded transition-colors"
                              style={{ background: 'var(--danger)', color: 'white' }}
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs px-2 py-0.5 rounded transition-colors"
                              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(s.id)}
                            className="text-xs transition-colors"
                            style={{ color: 'var(--danger)' }}
                          >
                            delete
                          </button>
                        )}
                        {editingTagsId !== s.id ? (
                          <button
                            onClick={() => setEditingTagsId(s.id)}
                            className="text-xs transition-colors"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            {s.tags && s.tags.length > 0 ? 'edit tags' : '+ tag'}
                          </button>
                        ) : null}
                      </div>
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

      {showDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl" style={{ background: 'var(--bg-surface)' }}>
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--danger)' }}>Delete Everything</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              This will permanently delete all sentences, cards, meanings, and review history. This cannot be undone.
            </p>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              Type <strong style={{ color: 'var(--text-primary)' }}>delete</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteAllInput}
              onChange={(e) => setDeleteAllInput(e.target.value)}
              placeholder="delete"
              className="w-full px-3 py-2 rounded-lg text-sm mb-4"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowDeleteAll(false); setDeleteAllInput(''); }}
                className="px-4 py-2 rounded-lg text-sm transition-colors"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleteAllInput !== 'delete'}
                className="px-4 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: deleteAllInput === 'delete' ? 'var(--danger)' : 'var(--bg-inset)',
                  color: deleteAllInput === 'delete' ? 'white' : 'var(--text-tertiary)',
                  cursor: deleteAllInput === 'delete' ? 'pointer' : 'not-allowed',
                }}
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
