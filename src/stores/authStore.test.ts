/**
 * Offline cold-start behavior of authStore.initialize().
 *
 * The scenario under test: the app is opened with no signal after the access
 * token has expired. getSession() then fails its network refresh and reports
 * no session, even though the stored session (and all local data) is intact.
 * initialize() must fall back to the locally cached user instead of dumping
 * the user on the login screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import type { Session, User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => {
  const state = {
    getSession: undefined as unknown as () => Promise<{
      data: { session: Session | null };
      error: Error | null;
    }>,
    authCallback: undefined as unknown as (event: string, session: Session | null) => void,
    setCachedUserIdCalls: [] as string[],
  };
  return state;
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
        mocks.authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => mocks.getSession(),
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}));

vi.mock('../db/repo', () => ({
  setCachedUserId: (id: string) => mocks.setCachedUserIdCalls.push(id),
  clearCachedUserId: vi.fn(),
}));

vi.mock('../db/localDb', () => ({ clearLocalDb: vi.fn() }));

const CACHED_USER_KEY = 'mandao:last-auth-user';
const user = { id: 'user-1', email: 'a@b.c' } as User;
const session = { user } as Session;

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

async function loadStore() {
  vi.resetModules();
  const { useAuthStore } = await import('./authStore');
  return useAuthStore;
}

const retryableError = new AuthRetryableFetchError('fetch failed', 0);

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorage());
  vi.stubGlobal('navigator', { onLine: true });
  mocks.setCachedUserIdCalls.length = 0;
  mocks.getSession = () =>
    Promise.resolve({ data: { session: null }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('initialize', () => {
  it('sets the user and caches it when a session is restored', async () => {
    mocks.getSession = () => Promise.resolve({ data: { session }, error: null });
    const store = await loadStore();
    await store.getState().initialize();

    expect(store.getState().user?.id).toBe('user-1');
    expect(store.getState().loading).toBe(false);
    expect(JSON.parse(localStorage.getItem(CACHED_USER_KEY)!).id).toBe('user-1');
  });

  it('shows login when there is no session and no cached user', async () => {
    const store = await loadStore();
    await store.getState().initialize();

    expect(store.getState().user).toBeNull();
    expect(store.getState().loading).toBe(false);
  });

  it('boots immediately from the cached user when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    // getSession stays pending, like the ~25s offline refresh-retry loop.
    let resolveSession!: (v: { data: { session: Session | null }; error: Error | null }) => void;
    mocks.getSession = () => new Promise((resolve) => (resolveSession = resolve));

    const store = await loadStore();
    const done = store.getState().initialize();

    // User is available before getSession() settles.
    expect(store.getState().user?.id).toBe('user-1');
    expect(store.getState().loading).toBe(false);
    expect(mocks.setCachedUserIdCalls).toContain('user-1');

    resolveSession({ data: { session: null }, error: retryableError });
    await done;
    expect(store.getState().user?.id).toBe('user-1');
  });

  it('falls back to the cached user when the refresh fails with a network error', async () => {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    mocks.getSession = () =>
      Promise.resolve({ data: { session: null }, error: retryableError });

    const store = await loadStore();
    await store.getState().initialize();

    expect(store.getState().user?.id).toBe('user-1');
    expect(mocks.setCachedUserIdCalls).toContain('user-1');
  });

  it('boots from cache after the grace period when getSession() is slow', async () => {
    vi.useFakeTimers();
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    let resolveSession!: (v: { data: { session: Session | null }; error: Error | null }) => void;
    mocks.getSession = () => new Promise((resolve) => (resolveSession = resolve));

    const store = await loadStore();
    const done = store.getState().initialize();

    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getState().user?.id).toBe('user-1');

    resolveSession({ data: { session: null }, error: retryableError });
    await done;
    expect(store.getState().user?.id).toBe('user-1');
  });

  it('signs out when there is genuinely no session, clearing the cache', async () => {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    // No error: the server answered and there is no session to restore.
    const store = await loadStore();
    await store.getState().initialize();

    expect(store.getState().user).toBeNull();
    expect(localStorage.getItem(CACHED_USER_KEY)).toBeNull();
  });

  it('ignores a null INITIAL_SESSION event after booting from cache', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    mocks.getSession = () => new Promise(() => {});

    const store = await loadStore();
    store.getState().initialize();
    expect(store.getState().user?.id).toBe('user-1');

    mocks.authCallback('INITIAL_SESSION', null);
    expect(store.getState().user?.id).toBe('user-1');
  });

  it('boots from cache when getSession() rejects within the grace window', async () => {
    // e.g. another tab stealing the auth navigator lock while offline.
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    mocks.getSession = () => Promise.reject(new Error('lock stolen'));

    const store = await loadStore();
    await store.getState().initialize();

    expect(store.getState().user?.id).toBe('user-1');
    expect(store.getState().loading).toBe(false);
  });

  it('ignores a cached user without an id', async () => {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify({ email: 'a@b.c' }));

    const store = await loadStore();
    await store.getState().initialize();

    expect(store.getState().user).toBeNull();
    expect(store.getState().loading).toBe(false);
  });

  it('does not resurrect the user when sign-out races a pending session restore', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    let resolveSession!: (v: { data: { session: Session | null }; error: Error | null }) => void;
    mocks.getSession = () => new Promise((resolve) => (resolveSession = resolve));

    const store = await loadStore();
    const done = store.getState().initialize();
    expect(store.getState().user?.id).toBe('user-1');

    await store.getState().signOut();
    expect(store.getState().user).toBeNull();

    // The stalled refresh finally succeeds with the signed-out user's session.
    resolveSession({ data: { session }, error: null });
    await done;

    expect(store.getState().user).toBeNull();
    expect(localStorage.getItem(CACHED_USER_KEY)).toBeNull();
  });

  it('still signs out on an explicit SIGNED_OUT event', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    mocks.getSession = () => new Promise(() => {});

    const store = await loadStore();
    store.getState().initialize();
    expect(store.getState().user?.id).toBe('user-1');

    mocks.authCallback('SIGNED_OUT', null);
    expect(store.getState().user).toBeNull();
    expect(localStorage.getItem(CACHED_USER_KEY)).toBeNull();
  });
});
