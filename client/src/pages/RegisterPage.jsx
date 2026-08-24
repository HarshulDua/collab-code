import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { AuthShell } from '../components/ui/AuthShell';
import { GoogleButton } from '../components/ui/GoogleButton';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await register(name, email, password);
    setSubmitting(false);
    if (ok) navigate('/rooms');
  }

  return (
    <AuthShell
      heading="Start collaborating"
      subheading="Create an account to open your first room"
      altPrompt="Already have an account?"
      altLabel="Log in"
      altTo="/login"
    >
      <h2>Create your account</h2>
      {error && <p className="error-text">{error}</p>}

      <form onSubmit={onSubmit}>
        <label className="field-label" htmlFor="register-name">
          Name
        </label>
        <input
          id="register-name"
          placeholder="Name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <label className="field-label" htmlFor="register-email">
          Email
        </label>
        <input
          id="register-email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="field-label" htmlFor="register-password">
          Password
        </label>
        <input
          id="register-password"
          type="password"
          placeholder="Password (min 8 characters)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        <button className="btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>

      <div className="or-rule">
        <span>or</span>
      </div>

      <GoogleButton label="Continue with Google" onDone={() => navigate('/rooms')} />
    </AuthShell>
  );
}
