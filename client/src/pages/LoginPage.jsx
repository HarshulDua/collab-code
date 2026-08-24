import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { AuthShell } from '../components/ui/AuthShell';
import { GoogleButton } from '../components/ui/GoogleButton';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await login(email, password);
    setSubmitting(false);
    if (ok) navigate('/rooms');
  }

  return (
    <AuthShell
      heading="Welcome back"
      subheading="Log in to continue collaborating"
      altPrompt="Don't have an account?"
      altLabel="Sign up"
      altTo="/register"
    >
      <h2>Log in to your account</h2>
      {error && <p className="error-text">{error}</p>}

      <form onSubmit={onSubmit}>
        <label className="field-label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div className="field-label-row">
          <label className="field-label" htmlFor="login-password">
            Password
          </label>
          <Link className="field-aside" to="/register">
            Need an account?
          </Link>
        </div>
        <input
          id="login-password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log In'}
        </button>
      </form>

      <div className="or-rule">
        <span>or</span>
      </div>

      <GoogleButton label="Continue with Google" onDone={() => navigate('/rooms')} />

      <p className="auth-fineprint">
        By continuing you agree to keep your code and credentials your own responsibility.
      </p>
    </AuthShell>
  );
}
