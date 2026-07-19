const admin = require('firebase-admin');

let initError = null;

if (!admin.apps.length) {
  try {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    // Fail loudly and specifically instead of letting firebase-admin
    // throw a cryptic low-level error later on first use.
    if (!process.env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is missing from environment variables');
    if (!process.env.FIREBASE_CLIENT_EMAIL) throw new Error('FIREBASE_CLIENT_EMAIL is missing from environment variables');
    if (!process.env.FIREBASE_PRIVATE_KEY) throw new Error('FIREBASE_PRIVATE_KEY is missing from environment variables');
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      throw new Error(
        'FIREBASE_PRIVATE_KEY does not look like a valid PEM key after \\n replacement. ' +
        'Check that it is wrapped in quotes and uses literal \\n sequences, not real line breaks.'
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    console.log('[firebaseAdmin] Initialized OK for project:', process.env.FIREBASE_PROJECT_ID);
  } catch (err) {
    // Don't crash the whole serverless function on import — instead,
    // store the error so /api/debug/status and every route can report
    // exactly what went wrong instead of a bare 500.
    initError = err;
    console.error('[firebaseAdmin] INITIALIZATION FAILED:', err.message);
    console.error(err.stack);
  }
}

const db = admin.apps.length ? admin.firestore() : null;
const auth = admin.apps.length ? admin.auth() : null;
const bucket = admin.apps.length && process.env.FIREBASE_STORAGE_BUCKET ? admin.storage().bucket() : null;

/**
 * Runs a real Firestore round-trip (write + read + delete) so we can
 * confirm the service account actually has permission, not just that
 * initializeApp() didn't throw. Used by the /api/debug/status route.
 */
async function testFirestoreConnection() {
  if (initError) return { ok: false, stage: 'init', error: initError.message };
  if (!db) return { ok: false, stage: 'init', error: 'Firestore client was not created' };

  try {
    const ref = db.collection('_debug_ping').doc('ping');
    await ref.set({ pingedAt: new Date().toISOString() });
    const snap = await ref.get();
    await ref.delete();
    return { ok: true, readBack: snap.data() };
  } catch (err) {
    return { ok: false, stage: 'firestore_read_write', error: err.message, code: err.code };
  }
}

module.exports = { admin, db, auth, bucket, initError, testFirestoreConnection };
