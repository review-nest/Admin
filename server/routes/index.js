const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const env = require('../config/env');

const api = express.Router();

// Public (no login): only what the login screen needs. The Firebase *web* config is public by design.
api.get('/health', (req, res) => res.json({ ok: true }));
api.get('/public-config', (req, res) => res.json({ firebase: env.firebaseWebConfig }));

api.use(authenticate);

// Money / bulk endpoints get a tighter limit on top of the global one
const strict = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many actions. Wait a minute and try again.', code: 'RATE_LIMIT' } });
api.use('/approvals/decide', strict);
api.use('/withdrawals', (req, res, next) => (req.method === 'GET' ? next() : strict(req, res, next)));
api.use('/users/:id/wallet', strict);
api.use('/notifications/send', strict);

api.use('/dashboard', require('./dashboard'));
api.use('/tasks', require('./tasks'));
api.use('/comments', require('./comments'));
api.use('/approvals', require('./approvals'));
api.use('/users', require('./users'));
api.use('/withdrawals', require('./withdrawals'));
api.use('/reports', require('./reports'));
api.use('/notifications', require('./notifications'));
api.use('/settings', require('./settings'));

module.exports = api;
