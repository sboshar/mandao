import { create } from 'zustand';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pendingCount: number;
  errorMessage: string | null;
  online: boolean;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (ts: number) => void;
  setPendingCount: (count: number) => void;
  setError: (msg: string | null) => void;
  setOnline: (online: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: navigator.onLine ? 'synced' : 'offline',
  lastSyncedAt: null,
  pendingCount: 0,
  errorMessage: null,
  online: navigator.onLine,
  setStatus: (status) => set({ status, errorMessage: status === 'error' ? undefined : null }),
  setLastSyncedAt: (ts) => set({ lastSyncedAt: ts }),
  setPendingCount: (count) => set({ pendingCount: count }),
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
