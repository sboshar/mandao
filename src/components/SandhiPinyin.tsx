/**
 * Sandhi pinyin with the changed syllables explained (#196).
 *
 * A learner sees bu4 shi4 in one field and bú shì in another and has no way to
 * find out why they differ. Underlined syllables are the ones a rule rewrote;
 * clicking one says which rule and names the syllable that triggered it.
 *
 * Every explanation comes from the fixed table in lib/sandhiRules.ts. Nothing
 * here asks a model: the rules are mechanical, a table is right every time, and
 * it can state which rule the CODE applied — which a model could only guess at.
 */
import { useState } from 'react';
import { SANDHI_RULES } from '../lib/sandhiRules';
import { numericToDiacritic } from '../services/toneSandhi';
import type { SandhiChange } from '../services/toneSandhi';

type Change = SandhiChange & { triggerSyllable?: string };

export function SandhiPinyin({
  pinyinSandhi,
  changes,
}: {
  /** Space-separated diacritic syllables, as displayed. */
  pinyinSandhi: string;
  changes?: Change[];
}) {
  const [open, setOpen] = useState<number | null>(null);

  const syllables = pinyinSandhi.split(/\s+/).filter(Boolean);
  const byIndex = new Map((changes ?? []).map((c) => [c.index, c]));

  if (byIndex.size === 0) return <>{pinyinSandhi}</>;

  const active = open !== null ? byIndex.get(open) : undefined;
  const rule = active ? SANDHI_RULES[active.ruleId] : undefined;

  return (
    <span>
      {syllables.map((syl, i) => {
        const change = byIndex.get(i);
        if (!change) return <span key={i}>{i > 0 ? ' ' : ''}{syl}</span>;
        return (
          <span key={i}>
            {i > 0 ? ' ' : ''}
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="underline decoration-dotted cursor-pointer"
              style={{ color: 'var(--accent)' }}
              title="Tone changed — click for the rule"
            >
              {syl}
            </button>
          </span>
        );
      })}

      {active && rule && (
        <span
          className="block mt-1 p-2 rounded text-xs"
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {rule.name}
          </span>
          {': '}
          {rule.statement}
          <span className="block mt-1">
            Here{' '}
            <span className="font-mono">{numericToDiacritic(active.from)}</span>
            {' → '}
            <span className="font-mono">{numericToDiacritic(active.to)}</span>
            {active.triggerSyllable && (
              <>
                {', because the next syllable is '}
                <span className="font-mono">
                  {numericToDiacritic(active.triggerSyllable)}
                </span>
                {active.triggerIndex === -1 && ' in the following word'}
                {'.'}
              </>
            )}
          </span>
          {rule.note && (
            <span className="block mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {rule.note}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
