import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { GoogleMark } from './Icons';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

let scriptPromise = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GSI_SRC;
    el.async = true;
    el.defer = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not reach Google sign-in'));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * Renders Google's own sign-in button. Google requires its rendered button (or
 * One Tap) for the credential flow — a hand-drawn button cannot produce an ID
 * token — so this uses `renderButton` with the theme that most closely matches
 * the rest of the form, rather than faking one that wouldn't work.
 *
 * When no client ID is configured the button still appears, disabled, with the
 * reason — a missing environment variable shouldn't blank out part of the form.
 */
export function GoogleButton({ label = 'Continue with Google', onDone }) {
  const holder = useRef(null);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const [failure, setFailure] = useState(CLIENT_ID ? null : 'Google sign-in is not configured on this deployment');

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let cancelled = false;

    loadGsi()
      .then(() => {
        if (cancelled || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            const ok = await loginWithGoogle(credential);
            if (ok) onDone?.();
          },
        });
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: holder.current.clientWidth || 320,
        });
      })
      .catch((err) => {
        if (!cancelled) setFailure(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle, onDone]);

  if (failure) {
    return (
      <button className="btn-google" type="button" disabled title={failure}>
        <GoogleMark />
        <span>{label}</span>
      </button>
    );
  }

  return <div className="google-btn-holder" ref={holder} />;
}
