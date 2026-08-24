const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { signToken } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const router = express.Router();

// Built lazily so a deployment without Google configured never constructs one,
// and so tests can run without the dependency being reachable.
let cachedGoogleClient = null;
function googleClient() {
  if (!cachedGoogleClient) {
    // eslint-disable-next-line global-require
    const { OAuth2Client } = require('google-auth-library');
    cachedGoogleClient = new OAuth2Client(env.googleClientId);
  }
  return cachedGoogleClient;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authRateLimit = rateLimit({ keyPrefix: 'auth', limit: env.authRateLimitPerMin, windowSeconds: 60 });

router.post(
  '/register',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      throw new ApiError(400, 'name, email and password are required');
    }
    if (!EMAIL_RE.test(email)) {
      throw new ApiError(400, 'Invalid email');
    }
    if (String(password).length < 8) {
      throw new ApiError(400, 'Password must be at least 8 characters');
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      throw new ApiError(409, 'Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email: email.toLowerCase(), passwordHash });
    const token = signToken(user);
    res.status(201).json({ token, user: user.toPublicJSON() });
  })
);

router.post(
  '/login',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new ApiError(400, 'email and password are required');
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      throw new ApiError(401, 'Invalid credentials');
    }
    // A Google-created account has no password of its own. Say so rather than
    // returning "invalid credentials" for a password that never existed.
    if (!user.passwordHash) {
      throw new ApiError(401, 'This account was created with Google — use "Continue with Google"');
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const token = signToken(user);
    res.json({ token, user: user.toPublicJSON() });
  })
);

router.post(
  '/google',
  authRateLimit,
  asyncHandler(async (req, res) => {
    if (!env.googleClientId) {
      throw new ApiError(503, 'Google sign-in is not configured on this server');
    }

    const { credential } = req.body || {};
    if (!credential) {
      throw new ApiError(400, 'credential is required');
    }

    // Verifies the signature, the issuer, the audience (our own client id) and
    // the expiry. Without the audience check any valid Google token from any
    // application would be accepted here.
    let payload;
    try {
      const ticket = await googleClient().verifyIdToken({
        idToken: credential,
        audience: env.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new ApiError(401, 'Could not verify that Google sign-in');
    }

    if (!payload?.email || !payload.email_verified) {
      throw new ApiError(401, 'Google account has no verified email address');
    }

    const email = payload.email.toLowerCase();
    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });

    if (!user) {
      user = await User.create({
        name: payload.name || email.split('@')[0],
        email,
        googleId: payload.sub,
        picture: payload.picture || null,
      });
    } else {
      // Existing password account signing in with Google for the first time:
      // link the two rather than creating a duplicate for the same address.
      let dirty = false;
      if (!user.googleId) {
        user.googleId = payload.sub;
        dirty = true;
      }
      if (payload.picture && user.picture !== payload.picture) {
        user.picture = payload.picture;
        dirty = true;
      }
      if (dirty) await user.save();
    }

    const token = signToken(user);
    res.json({ token, user: user.toPublicJSON() });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }
    res.json({ user: user.toPublicJSON() });
  })
);

module.exports = router;
