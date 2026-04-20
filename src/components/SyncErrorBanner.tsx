import { useState } from 'react';
import { useSyncStore } from '../stores/syncStore';
import { runSync } from '../db/syncEngine';
import type { SyncOpType } from '../db/localDb';

const OP_LABELS: Record<SyncOpType, string> = {
  reviewCard: 'card review',
  ingestBundle: 'new sentence',
  deleteEntity: 'delete',
  deleteAllData: 'clear all data',
  updateTags: 'tag update',
  upsertAudioRecording: 'audio upload',
};

export function SyncErrorBanner() {
  const failedCount = useSyncStore((s) => s.failedCount);
  const failedOps = useSyncStore((s) => s.failedOps);
  const status = useSyncStore((s) => s.status);
  const [expanded, setExpanded] = useState(false);

  if (failedCount === 0) return null;

  return (
    <div
      className="sticky top-0 z-50 px-4 py-2 text-xs"
      style={{
        background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-surface))',
        borderBottom: '1px solid var(--danger)',
        color: 'var(--text-primary)',
      }}
      role="alert"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span>
          <strong>{failedCount}</strong> change{failedCount === 1 ? '' : 's'} couldn't sync to the
          server. They're saved locally but won't reach other devices until resolved.
        </span>
        <button
          type="button"
          onClick={() => runSync()}
          disabled={status === 'syncing'}
          className="px-2 py-0.5 rounded transition-colors disabled:opacity-50"
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          {status === 'syncing' ? 'Retrying…' : 'Retry'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="px-2 py-0.5 rounded transition-colors"
          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {expanded && failedOps.length > 0 && (
        <ul className="mt-2 space-y-1">
          {failedOps.map((op, i) => (
            <li key={i} style={{ color: 'var(--text-secondary)' }}>
              <strong>{OP_LABELS[op.op]}</strong>
              {op.lastErrorCode && <> <span className="font-mono">({op.lastErrorCode})</span></>}
              : <span className="font-mono">{op.lastError ?? 'Unknown error'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
