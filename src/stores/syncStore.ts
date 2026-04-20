import { create } from 'zustand';
import type { SyncOp } from '../db/localDb';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

/** Subset of a SyncOp that the error banner needs — identity + error. */
export type FailedOp = Pick<SyncOp, 'op' | 'lastError' | 'lastErrorCode'>;

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pendingCount: number;
  /** Total count of ops in 'failed' status (may exceed failedOps.length — failedOps is capped for display). */
  failedCount: number;
  /** Up to N most-recent failed ops for the error banner's detail view. */
  failedOps: FailedOp[];
  errorMessage: string | null;
  online: boolean;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (ts: number) => void;
  setPendingCount: (count: number) => void;
  setFailed: (count: number, samples: FailedOp[]) => void;
  setError: (msg: string | null) => void;
  setOnline: (online: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: navigator.onLine ? 'synced' : 'offline',
  lastSyncedAt: null,
  pendingCount: 0,
  failedCount: 0,
  failedOps: [],
  errorMessage: null,
  online: navigator.onLine,
  setStatus: (status) => set(status === 'error' ? { status } : { status, errorMessage: null }),
  setLastSyncedAt: (ts) => set({ lastSyncedAt: ts }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setFailed: (count, samples) =>
    set((state) => ({
      failedCount: count,
      failedOps: samples,
      // Failed ops are terminal — keep status 'error' so the SyncIndicator
      // dot stays red, without relying on a duplicate setError() call.
      status: count > 0 ? 'error' : state.status,
      errorMessage:
        count > 0 ? `${count} change${count === 1 ? '' : 's'} couldn't sync` : state.errorMessage,
    })),
  setError: (msg) => set({ errorMessage: msg, status: msg ? 'error' : 'synced' }),
  // When going online, don't claim 'synced' — let runSync update status.
  // When going offline, set status immediately.
  setOnline: (online) => set((state) => ({
    online,
    status: online
      ? (state.status === 'offline' ? (state.lastSyncedAt ? 'synced' : 'syncing') : state.status)
      : 'offline',
  })),
}));
