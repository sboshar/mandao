import { create } from 'zustand';
import type { SyncOpType } from '../db/localDb';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface FailedOpSummary {
  opType: SyncOpType;
  error: string;
  code?: string;
}

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pendingCount: number;
  /** Count of ops stuck in 'failed' status — won't retry automatically. */
  failedCount: number;
  /** Up to N most-recent failed ops for the error banner's detail view. */
  failedOps: FailedOpSummary[];
  errorMessage: string | null;
  online: boolean;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (ts: number) => void;
  setPendingCount: (count: number) => void;
  setFailed: (count: number, samples: FailedOpSummary[]) => void;
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
  setFailed: (count, samples) => set({ failedCount: count, failedOps: samples }),
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
