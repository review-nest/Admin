/* Firebase Authentication (login only). All data access goes through our own /api with a verified ID token. */
import { formDialog } from './ui.js';

let auth = null; let M = null;

export async function initAuth(onChange) {
  const cfg = (await (await fetch('/api/public-config')).json()).firebase;
  if (!cfg.apiKey) throw new Error('Server is missing FIREBASE_WEB_API_KEY (see .env.example).');
  const V = '10.14.1';
  const [appM, authM] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  ]);
  M = authM;
  auth = authM.getAuth(appM.initializeApp(cfg));
  authM.onAuthStateChanged(auth, onChange);
}

export const currentUser = () => auth?.currentUser || null;
export const getToken = async (force = false) => {
  if (!auth?.currentUser) throw Object.assign(new Error('Please log in'), { status: 401, code: 'NO_USER' });
  return auth.currentUser.getIdToken(force);
};
export const loginGoogle = () => M.signInWithPopup(auth, new M.GoogleAuthProvider());
export const loginEmail = (email, pass) => M.signInWithEmailAndPassword(auth, email, pass);
export const resetPassword = (email) => M.sendPasswordResetEmail(auth, email);
export const sendVerification = () => M.sendEmailVerification(auth.currentUser);
export const logout = () => M.signOut(auth);

/** Called by api.js when the server answers REAUTH_REQUIRED (mark paid, wallet adjust, maintenance...). */
export async function forceReauth() {
  const user = auth.currentUser;
  const provider = user.providerData[0]?.providerId;
  if (provider === 'google.com') {
    await M.reauthenticateWithPopup(user, new M.GoogleAuthProvider());
  } else {
    const v = await formDialog({
      title: 'Confirm it is you', submitText: 'Confirm', note: 'This action is sensitive. Enter your password again to continue.',
      fields: [{ name: 'password', label: 'Password', type: 'password', required: true }],
      onSubmit: async (vals) => {
        try { await M.reauthenticateWithCredential(user, M.EmailAuthProvider.credential(user.email, vals.password)); }
        catch { throw new Error('Wrong password'); }
      },
    });
    if (!v) throw Object.assign(new Error('Action cancelled'), { cancelled: true });
  }
  await user.getIdToken(true); // new token carries a fresh auth_time
}

export function friendlyAuthError(e) {
  const c = e.code || '';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return 'Google sign-in was closed before finishing.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email or password is not correct.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a few minutes or reset your password.';
  if (c.includes('network')) return 'Network problem. Check your connection and try again.';
  if (c.includes('unauthorized-domain')) return 'This website address is not added in Firebase > Authentication > Authorized domains.';
  return e.message || 'Could not log in.';
}
