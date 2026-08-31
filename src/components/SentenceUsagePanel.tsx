/**
 * "When would I say this?" — usage notes for one sentence (#212).
 *
 * Shared by every surface that shows a whole sentence: the back of a review
 * card, the sentence card behind a token, and the review step of the add flow.
 * They differ only in whether the notes can be generated from there.
 *
 * GENERATE ONCE, THEN READ. The notes are cached on the sentence row and synced,
 * so the LLM call happens once per sentence for the whole account rather than
 * once per card view — a sentence in review comes up hundreds of times, and
 * paying for the same paragraph each time would be both slow and expensive
 * (this is the mistake #207 describes in the suggestion panel). The consequence
 * is that a note can be stale relative to a hand-edited translation, which is
 * why rewrite and delete both stay available, with the model and date shown
 * beside them.
 *
 * Each situation carries a Mandarin line, and each line has a + that hands off
 * to the normal /add?chinese= flow rather than ingesting directly — the same
 * route the suggestion panel takes (#187). A line is only a string; making it a
 * card needs segmentation, pinyin and per-character glosses, and that pipeline
 * plus its review screen already exist.
 *
 * On a device with no API key the panel stays visible and greyed rather than
 * disappearing: the key lives in localStorage, so the same account on a phone
 * would otherwise silently lose the feature with nothing on screen to explain
 * why, which reads as a feature the app does not have (#202).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Sentence, SentenceUsage, UsageSituation } from '../db/schema';
import * as repo from '../db/repo';
import { generateSentenceUsage, readSituations } from '../services/sentenceUsage';
import { isAIConfigured } from '../services/aiProvider';
import { AIKeyRequired } from './AIKeyRequired';

const REGISTER_LABELS: Record<SentenceUsage['register'], string> = {
  formal: 'formal',
  neutral: 'neutral',
  casual: 'casual',
  slang: 'slang',
  literary: 'literary',
};

const MEDIUM_LABELS: Record<SentenceUsage['medium'], string> = {
  spoken: 'spoken',
  written: 'written',
  both: 'spoken & written',
};

/**
 * Registers a learner can get wrong in a way that costs them something get a
 * warning tint; the ones that are safe to use anywhere stay quiet. Colour here
 * is information, not decoration.
 */
const REGISTER_TONE: Record<SentenceUsage['register'], 'neutral' | 'warn'> = {
  formal: 'neutral',
  neutral: 'neutral',
  casual: 'neutral',
  slang: 'warn',
  literary: 'warn',
};

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <span
      className="px-1.5 py-0.5 text-xs rounded-full whitespace-nowrap"
      style={
        tone === 'warn'
          ? { background: 'var(--warning-subtle)', color: 'var(--warning)' }
          : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
      }
    >
      {children}
    </span>
  );
}

function formatWhen(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * One situation: the English moment, then the Mandarin line from it.
 *
 * `inDeck` is resolved by the parent for the whole list at once. Offering "+ add"
 * on a sentence the deck already has would route to /add only for ingestion to
 * reject it as a duplicate, which reads as a bug rather than as information the
 * panel already had.
 */
function SituationRow({
  situation,
  inDeck,
  onAdd,
}: {
  situation: UsageSituation;
  inDeck: boolean;
  onAdd?: (chinese: string) => void;
}) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
        &bull;
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {situation.situation}
        </div>
        {situation.chinese && (
          <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
            <span className="text-base" style={{ color: 'var(--text-primary)' }}>
              {situation.chinese}
            </span>
            {situation.english && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {situation.english}
              </span>
            )}
            {inDeck ? (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                in deck
              </span>
            ) : (
              onAdd && (
                <button
                  type="button"
                  onClick={() => onAdd(situation.chinese!)}
                  className="text-xs underline"
                  style={{ color: 'var(--accent)' }}
                >
                  + add
                </button>
              )
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** The notes themselves — no fetching, so the add flow can show an unsaved one. */
export function SentenceUsageNotes({
  usage,
  onAdd,
  inDeck,
}: {
  usage: SentenceUsage;
  /** Omitted where adding is not offered (the add flow's own review step). */
  onAdd?: (chinese: string) => void;
  /** Normalized Chinese of the example lines already in the deck. */
  inDeck?: Set<string>;
}) {
  const situations = readSituations(usage.situations);

  return (
    <div className="space-y-2 text-left">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip tone={REGISTER_TONE[usage.register]}>
          {REGISTER_LABELS[usage.register] ?? usage.register}
        </Chip>
        <Chip>{MEDIUM_LABELS[usage.medium] ?? usage.medium}</Chip>
        {usage.speechAct && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {usage.speechAct}
          </span>
        )}
      </div>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {usage.description}
      </p>

      {situations.length > 0 && (
        <ul className="space-y-2">
          {situations.map((s, i) => (
            <SituationRow
              key={i}
              situation={s}
              inDeck={!!s.chinese && !!inDeck?.has(s.chinese)}
              onAdd={onAdd}
            />
          ))}
        </ul>
      )}

      {usage.caution && (
        <p
          className="text-xs p-2 rounded"
          style={{ background: 'var(--warning-subtle)', color: 'var(--text-secondary)' }}
        >
          {usage.caution}
        </p>
      )}
    </div>
  );
}

export function SentenceUsagePanel({
  sentence,
  onUsage,
  onNavigate,
}: {
  sentence: Sentence;
  /** Lets the host update its own copy of the row without a re-read. */
  onUsage?: (usage: SentenceUsage | undefined) => void;
  /** Lets a host close its modal before we route away. */
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which example lines the deck already has, keyed by the line as written. */
  const [inDeck, setInDeck] = useState<Set<string>>(new Set());
  const aiReady = isAIConfigured();
  const usage = sentence.usage;

  // Resolve the deck membership of every example line in one pass. Cheap — a
  // handful of indexed lookups against normalizedChinese — and re-run whenever
  // the notes change, which covers a rewrite landing new lines.
  useEffect(() => {
    const lines = readSituations(usage?.situations)
      .map((s) => s.chinese)
      .filter((c): c is string => !!c);
    if (lines.length === 0) {
      setInDeck(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const found = await Promise.all(
        lines.map(async (line) => ((await repo.getSentenceByNormalizedChinese(line)) ? line : null)),
      );
      if (!cancelled) setInDeck(new Set(found.filter((l): l is string => !!l)));
    })();
    return () => { cancelled = true; };
  }, [usage]);

  const generate = async () => {
    setLoading(true);
    setError('');
    setConfirmDelete(false);
    try {
      const next = await generateSentenceUsage(sentence.chinese, sentence.english);
      await repo.setSentenceUsage(sentence.id, next);
      onUsage?.(next);
      setOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not work out the usage notes');
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    setError('');
    setConfirmDelete(false);
    try {
      await repo.setSentenceUsage(sentence.id, null);
      onUsage?.(undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete the usage notes');
    }
  };

  const addExample = (chinese: string) => {
    onNavigate?.();
    navigate(`/add?chinese=${encodeURIComponent(chinese)}`);
  };

  // Nothing stored and no key on this device: the greyed stand-in explains
  // why, which a hidden panel could not (#202).
  if (!usage && !aiReady) {
    return (
      <div className="flex justify-center">
        <AIKeyRequired
          label="When would I say this?"
          className="text-xs"
          style={{ color: 'var(--text-tertiary)' }}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="w-full px-3 py-2 rounded text-sm inset surface-hover transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          {loading ? 'Working out when you’d use this…' : 'When would I say this?'}
        </button>
        {error && (
          <div
            className="p-2 rounded text-xs"
            style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning)' }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded p-3 inset space-y-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
          When you&rsquo;d use this
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <>
          <SentenceUsageNotes usage={usage} onAdd={addExample} inDeck={inDeck} />

          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {usage.model ? `${usage.model} · ` : ''}
              {formatWhen(usage.generatedAt)}
            </span>
            <div className="flex items-center gap-3">
              {aiReady ? (
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  className="text-xs transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {loading ? 'rewriting…' : 'rewrite'}
                </button>
              ) : (
                <AIKeyRequired
                  label="rewrite"
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                  onNavigate={onNavigate}
                />
              )}
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>Delete notes?</span>
                  <button
                    type="button"
                    onClick={remove}
                    className="px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--danger)', color: 'white' }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs transition-colors"
                  style={{ color: 'var(--danger)' }}
                >
                  delete
                </button>
              )}
            </div>
          </div>

          {error && (
            <div
              className="p-2 rounded text-xs"
              style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning)' }}
            >
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
