import { useSyncStore, type SyncStatus } from '../stores/syncStore';
import { runSync } from '../db/syncEngine';

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const statusConfig: Record<SyncStatus, { label: string; dotClass: string }> = {
  synced: { label: 'Synced', dotClass: 'bg-emerald-400' },
  syncing: { label: 'Syncing', dotClass: 'bg-amber-400 animate-pulse' },
  offline: { label: 'Offline', dotClass: 'bg-gray-400' },
  error: { label: 'Sync error', dotClass: 'bg-red-400' },
};

export function SyncIndicator() {
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const errorMessage = useSyncStore((s) => s.errorMessage);
  const config = statusConfig[status];

  const tooltip = errorMessage
    ? `Error: ${errorMessage}`
    : lastSyncedAt
      ? `Last synced ${formatTimeAgo(lastSyncedAt)}`
      : 'Not synced yet';

  return (
    <button
      onClick={() => runSync()}
      title={tooltip}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
      style={{ color: 'var(--text-tertiary)' }}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      <span>{config.label}</span>
    </button>
  );
}
