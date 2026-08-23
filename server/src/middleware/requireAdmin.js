const env = require('../config/env');

function requireAdmin(req, res, next) {
  if (!env.adminEmail || req.user?.email !== env.adminEmail) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

module.exports = { requireAdmin };
