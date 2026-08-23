import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WebRTC's getUserMedia (camera/mic) only works in a "secure context" —
// HTTPS, or the special-cased "localhost". A plain http://<lan-ip>:...
// origin (needed to reach this app from a *different* device on the same
// network) is not a secure context, so browsers silently refuse to even
// prompt for camera/mic permission there. Serving over HTTPS with a
// locally-generated self-signed cert (scripts/generate-cert.sh) fixes
// this — see ARCHITECTURE.md's WebRTC section for the full story.
//
// Gated behind ENABLE_HTTPS=1 (not just cert presence) to match the
// server (server.js) — Playwright's e2e suite starts this dev server via
// plain `npm run dev` with no such flag, and its Chromium doesn't trust a
// self-signed cert by default, so e2e stays on plain HTTP deliberately.
const certPath = path.join(__dirname, '..', 'certs', 'dev-cert.pem');
const keyPath = path.join(__dirname, '..', 'certs', 'dev-key.pem');
const httpsConfig =
  process.env.ENABLE_HTTPS === '1' && fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https: httpsConfig,
  },
});
