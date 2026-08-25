import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { clearCachedUserId, setCachedUserId } from '../db/repo';
import { clearLocalDb } from '../db/localDb';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

const GENERIC_AUTH_ERROR = 'Something went wrong. Please try again.';
const RATE_LIMIT_ERROR = 'Too many attempts. Please try again later.';

// Last authenticated user, cached so an offline cold start can boot into the
// app. Supabase keeps the session in localStorage too, but getSession()
// refuses to return it once the access token has expired and a network
// refresh fails — which is exactly the no-signal case.
const CACHED_USER_KEY = 'mandao:last-auth-user';

// How long to let getSession() block boot before falling back to the cached
// user. Offline, its token-refresh retries take ~25s; navigator.onLine can
// report true on dead connections, so a timeout is needed either way.
const SESSION_RESTORE_TIMEOUT_MS = 3000;

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User): void {
  try {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  } catch {
    // Quota/private-mode failures just lose the offline-boot optimization.
  }
}

function clearCachedUser(): void {
  try {
    localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    // ignore
  }
}

function isRateLimited(error: { status?: number; message?: string }): boolean {
  return error.status === 429 || /rate limit|too many/i.test(error.message ?? '');
}

async function deleteLegacyIndexedDb(): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;

  await new Promise<void>((resolve) => {
    const request = window.indexedDB.deleteDatabase('MandarinApp');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

interface AuthState {
  user: User | null;
  loading: boolean;
  needsPasswordReset: boolean;
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<string | null>;
  signUpWithEmail: (email: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

let initialized = false;
let authSubscription: { unsubscribe: () => void } | null = null;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  needsPasswordReset: false,

  initialize: async () => {
    if (initialized) return;
    initialized = true;

    // Subscribe first so PASSWORD_RECOVERY events during session
    // restoration are not missed.
    let lastUserId: string | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        writeCachedUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        clearCachedUser();
      }
      const newUserId = session?.user?.id ?? null;
      // A null session outside SIGNED_OUT is not a sign-out: INITIAL_SESSION
      // fires with null when an expired token can't be refreshed offline, and
      // must not kick a cached-user boot back to the login screen.
      if (!newUserId && event !== 'SIGNED_OUT') return;
      if (newUserId === lastUserId && event !== 'PASSWORD_RECOVERY') return;
      lastUserId = newUserId;
      set({
        user: session?.user ?? null,
        needsPasswordReset: event === 'PASSWORD_RECOVERY',
        loading: false,
      });
    });
    authSubscription = subscription;

    const cached = readCachedUser();
    const applyCachedUser = (user: User) => {
      lastUserId = user.id;
      // Local writes (reviews, decks, audio) stamp rows with this id; there
      // is no live session to seed it from, so do it here.
      setCachedUserId(user.id);
      set({ user, loading: false });
    };

    const sessionPromise = supabase.auth.getSession();

    // Offline cold start: don't leave the user staring at the loading screen
    // while getSession() retries a doomed token refresh. Boot with the cached
    // user and reconcile below whenever getSession() settles.
    let bootedFromCache = false;
    if (cached && !navigator.onLine) {
      bootedFromCache = true;
      applyCachedUser(cached);
    } else if (cached) {
      const winner = await Promise.race([
        sessionPromise,
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), SESSION_RESTORE_TIMEOUT_MS)
        ),
      ]);
      if (winner === 'timeout') {
        bootedFromCache = true;
        applyCachedUser(cached);
      }
    }

    try {
      const { data: { session }, error } = await sessionPromise;
      if (session?.user) {
        writeCachedUser(session.user);
        lastUserId = session.user.id;
        set({ user: session.user, loading: false });
      } else if (cached && error && isAuthRetryableFetchError(error)) {
        // Network unreachable — the stored session is intact and Supabase
        // will refresh it automatically once we're back online. Keep the
        // cached user so the app works offline.
        if (!bootedFromCache) applyCachedUser(cached);
      } else {
        // Genuinely signed out (no stored session, or refresh token rejected
        // by the server).
        clearCachedUser();
        lastUserId = null;
        set({ user: null, loading: false });
      }
    } catch (e) {
      // Unexpected failure — with a cached user, prefer keeping the app
      // usable over forcing a login we may not be able to complete.
      console.error('Session restore failed', e);
      if (cached) {
        if (!bootedFromCache) applyCachedUser(cached);
      } else {
        set({ user: null, loading: false });
      }
    }
  },

  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return null;
    if (isRateLimited(error)) return RATE_LIMIT_ERROR;
    return 'Invalid email or password';
  },

  signUpWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (!error) return null;
    if (isRateLimited(error)) return RATE_LIMIT_ERROR;
    if (error.message?.toLowerCase().includes('password'))
      return 'Password must be at least 8 characters';
    return GENERIC_AUTH_ERROR;
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Always return null to avoid leaking whether the email exists
    if (error) console.error('resetPassword failed');
    return null;
  },

  updatePassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) { set({ needsPasswordReset: false }); return null; }
    return GENERIC_AUTH_ERROR;
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (!error) return null;
    return GENERIC_AUTH_ERROR;
  },

  signOut: async () => {
    authSubscription?.unsubscribe();
    authSubscription = null;
    initialized = false;
    clearCachedUser();
    await supabase.auth.signOut();
    await clearLocalDb();
    await deleteLegacyIndexedDb();
    clearCachedUserId();
    set({ user: null });
  },
}));
