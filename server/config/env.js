require('dotenv').config();

const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

module.exports = {
  port: Number(process.env.PORT || 3000),
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  superAdminEmails: list(process.env.SUPER_ADMIN_EMAILS),
  tzOffsetMinutes: Number(process.env.TZ_OFFSET_MINUTES || 330),
  reauthWindowSec: Number(process.env.REAUTH_WINDOW_SEC || 300),
  presenceWindowMs: 2 * 60 * 1000,
  firebaseWebConfig: {
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'task-gullak.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'task-gullak',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
  },
};
