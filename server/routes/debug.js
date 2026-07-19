const express = require('express');
const { testFirestoreConnection, initError } = require('../utils/firebaseAdmin');

const router = express.Router();

/**
 * GET /api/debug/status?key=YOUR_DEBUG_KEY
 *
 * Protected by DEBUG_KEY so this never leaks info publicly in production.
 * Set DEBUG_KEY in your .env / Vercel env vars, then visit:
 *   https://your-app.vercel.app/api/debug/status?key=YOUR_DEBUG_KEY
 *
 * DELETE THIS ROUTE (or unset DEBUG_KEY) once you're done debugging —
 * it's meant to be temporary.
 */
router.get('/status', async (req, res) => {
  if (!process.env.DEBUG_KEY || req.query.key !== process.env.DEBUG_KEY) {
    return res.status(404).json({ error: 'Not found' });
  }

  const envCheck = {
    FIREBASE_PROJECT_ID: maskPresence(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: maskPresence(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: maskPresence(process.env.FIREBASE_PRIVATE_KEY, true),
    FIREBASE_STORAGE_BUCKET: maskPresence(process.env.FIREBASE_STORAGE_BUCKET),
    RAZORPAY_KEY_ID: maskPresence(process.env.RAZORPAY_KEY_ID),
    RAZORPAY_KEY_SECRET: maskPresence(process.env.RAZORPAY_KEY_SECRET),
    ADMIN_EMAILS: maskPresence(process.env.ADMIN_EMAILS),
    NODE_ENV: process.env.NODE_ENV || '(not set)',
  };

  const firestoreResult = await testFirestoreConnection();

  res.json({
    envCheck,
    firebaseInitError: initError ? { message: initError.message, stack: initError.stack } : null,
    firestoreConnectionTest: firestoreResult,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/debug/echo-error?key=YOUR_DEBUG_KEY
 * Deliberately throws, to confirm the error handler + logging pipeline
 * itself is working end to end.
 */
router.get('/echo-error', (req, res, next) => {
  if (!process.env.DEBUG_KEY || req.query.key !== process.env.DEBUG_KEY) {
    return res.status(404).json({ error: 'Not found' });
  }
  next(new Error('This is a deliberate test error from /api/debug/echo-error'));
});

function maskPresence(value, isKey = false) {
  if (!value) return 'MISSING';
  if (!isKey) return value.length > 40 ? value.slice(0, 40) + '…' : value;
  // For the private key, just confirm shape without printing the actual key
  return {
    length: value.length,
    looksLikePEM: value.includes('BEGIN PRIVATE KEY'),
    startsWithQuote: value.startsWith('"'),
    containsLiteralBackslashN: value.includes('\\n'),
    containsRealNewline: value.includes('\n'),
  };
}

module.exports = router;
