const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  let credential;
  if (b64) credential = admin.credential.cert(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')));
  else if (json) credential = admin.credential.cert(JSON.parse(json));
  else credential = admin.credential.applicationDefault(); // GOOGLE_APPLICATION_CREDENTIALS
  admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID || 'task-gullak' });
}
init();

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db, FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp };
