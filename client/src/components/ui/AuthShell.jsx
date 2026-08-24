import { Link } from 'react-router-dom';
import { CodeMark } from './Icons';

/**
 * Shared chrome for the login and register screens: product mark top-left, the
 * opposite auth action top-right, and a two-column body — pitch on the left,
 * form card on the right.
 */
export function AuthShell({ heading, subheading, altPrompt, altLabel, altTo, children }) {
  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <span className="brand">
          <span className="brand-mark">
            <CodeMark size={16} />
          </span>
          <span className="brand-name">CollabCode</span>
        </span>
        <span className="auth-alt">
          <span className="muted">{altPrompt}</span>
          <Link className="pill-link" to={altTo}>
            {altLabel}
          </Link>
        </span>
      </header>

      <div className="auth-body">
        <section className="auth-pitch">
          <span className="auth-pitch-mark">
            <CodeMark size={40} />
          </span>
          <h1>{heading}</h1>
          <p>{subheading}</p>
        </section>
        <section className="auth-card">{children}</section>
      </div>
    </div>
  );
}
