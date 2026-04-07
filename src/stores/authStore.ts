import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<string | null>;
  signUpWithEmail: (email: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

let initialized = false;
let authSubscription: { unsubscribe: () => void } | null = null;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,

  initialize: async () => {
    if (initialized) return;
    initialized = true;

    const { data: { session } } = await supabase.auth.getSession();
    set({ user: session?.user ?? null, session, loading: false });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, session });
    });
    authSubscription = subscription;
  },

  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  },

  signUpWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return error?.message ?? null;
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`,
    });
    return error?.message ?? null;
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return error?.message ?? null;
  },

  signOut: async () => {
    authSubscription?.unsubscribe();
    authSubscription = null;
    initialized = false;
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
}));
