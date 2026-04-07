import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

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

  const handleGoogle = async () => {
    setError('');
    const err = await signInWithGoogle();
    if (err) setError(err);
  };

  if (checkEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
        <div className="max-w-sm w-full text-center">
          <h1 className="text-2xl font-semibold mb-4">Check your email</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
          </p>
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
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
          >
            {loading ? '...' : isSignUp ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ background: 'var(--border-strong)' }} />
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-strong)' }} />
        </div>

        <button
          onClick={handleGoogle}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          Continue with Google
        </button>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-tertiary)' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            className="font-medium"
            style={{ color: 'var(--accent)' }}
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
}
