const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
require('./config/firebase'); // fail fast if credentials are missing
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errors');
const { startScheduler } = require('./services/notify');

const app = express();
if (env.trustProxy) app.set('trust proxy', 1);

app.use(helmet({
  // Needed so Firebase's Google sign-in popup can talk back to this page
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://www.gstatic.com', 'https://apis.google.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'", 'https://*.googleapis.com', 'https://*.firebaseapp.com', 'https://www.gstatic.com'],
      'frame-src': ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
      'object-src': ["'none'"],
    },
  },
}));

app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Slow down a little.', code: 'RATE_LIMIT' } }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', routes);
app.use('/api', notFound);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: env.isProd ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`ANY TASK admin running on http://localhost:${env.port}`);
  startScheduler();
});
