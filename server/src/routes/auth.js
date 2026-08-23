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
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new ApiError(401, 'Invalid credentials');
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
