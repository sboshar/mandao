import { useState, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

const THROTTLE_MS = 2000;

export function LoginPage() {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const lastSubmit = useRef(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const now = Date.now();
    if (now - lastSubmit.current < THROTTLE_MS) return;
    lastSubmit.current = now;

    setError('');
    setLoading(true);

    if (isForgot) {
      await resetPassword(email);
      setCheckEmail(true);
      setLoading(false);
      return;
    }

    const err = isSignUp
      ? await signUpWithEmail(email, password)
      : await signInWithEmail(email, password);

    if (err) {
      setError(err);
    } else if (isSignUp) {
      setCheckEmail(true);
    }
    setLoading(false);
  };

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = async () => {
    if (googleLoading) return;
    setError('');
    setGoogleLoading(true);
    const err = await signInWithGoogle();
    if (err) { setError(err); setGoogleLoading(false); }
  };

  if (checkEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
        <div className="max-w-sm w-full text-center">
          <h1 className="text-2xl font-semibold mb-4">Check your email</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {isForgot
              ? <>If an account exists for <strong>{email}</strong>, we sent a password reset link.</>
              : <>We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.</>}
          </p>
          <button
            onClick={() => { setCheckEmail(false); setIsForgot(false); setError(''); }}
            className="mt-4 text-sm font-medium"
            style={{ color: 'var(--accent)' }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-semibold text-center mb-1">Mandao</h1>
        <p className="text-center text-sm mb-8" style={{ color: 'var(--text-tertiary)' }}>
          Learn Mandarin through sentences
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            autoComplete="email"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          {!isForgot && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            {loading ? '...' : isForgot ? 'Send reset link' : isSignUp ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        {!isSignUp && !isForgot && (
          <div className="text-center mt-2">
            <button
              onClick={() => { setIsForgot(true); setError(''); }}
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Forgot password?
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ background: 'var(--border-strong)' }} />
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-strong)' }} />
        </div>

        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          {googleLoading ? '...' : 'Continue with Google'}
        </button>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-tertiary)' }}>
          {isForgot ? (
            <button
              onClick={() => { setIsForgot(false); setError(''); }}
              className="font-medium"
              style={{ color: 'var(--accent)' }}
            >
              Back to sign in
            </button>
          ) : (
            <>
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
                className="font-medium"
                style={{ color: 'var(--accent)' }}
              >
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
