import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import type { User } from '@supabase/supabase-js';

const GENERIC_AUTH_ERROR = 'Something went wrong. Please try again.';
const RATE_LIMIT_ERROR = 'Too many attempts. Please try again later.';

function isRateLimited(error: { status?: number; message?: string }): boolean {
  return error.status === 429 || /rate limit|too many/i.test(error.message ?? '');
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
      const newUserId = session?.user?.id ?? null;
      if (newUserId === lastUserId && event !== 'PASSWORD_RECOVERY') return;
      lastUserId = newUserId;
      set({
        user: session?.user ?? null,
        needsPasswordReset: event === 'PASSWORD_RECOVERY',
        loading: false,
      });
    });
    authSubscription = subscription;

    const { data: { session } } = await supabase.auth.getSession();
    lastUserId = session?.user?.id ?? null;
    set({ user: session?.user ?? null, loading: false });
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
    await supabase.auth.signOut();
    await db.delete();
    set({ user: null });
  },
}));
