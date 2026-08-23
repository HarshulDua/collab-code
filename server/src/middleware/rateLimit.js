const { checkAndConsume } = require('../services/rateLimiter');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

function rateLimit({ keyPrefix, limit, windowSeconds }) {
  return asyncHandler(async (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const allowed = await checkAndConsume(key, limit, windowSeconds);
    if (!allowed) {
      throw new ApiError(429, 'Too many requests, please try again shortly');
    }
    next();
  });
}

module.exports = { rateLimit };
