const express = require('express');
const { body, validationResult } = require('express-validator');
const { db, auth, initError } = require('../utils/firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');

const router = express.Router();
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

/**
 * POST /api/auth/register
 * Called once, right after the client finishes Firebase Auth signup
 * (email/password or Google). Creates the users/{uid} profile doc
 * that stores the role. req.user does not exist yet here because
 * there's no profile doc, so we verify the token manually.
 */
router.post(
  '/register',
  [
    body('idToken').notEmpty(),
    body('role').isIn(['influencer', 'brand']),
    body('displayName').trim().isLength({ min: 2, max: 80 }),
  ],
  async (req, res, next) => {
    // If firebase-admin failed to initialize (bad/missing env vars),
    // fail with a clear, specific message instead of a generic 500 —
    // this is the #1 cause of "everything returns 500" reports.
    if (initError) {
      return res.status(500).json({
        error: `Firebase Admin failed to initialize: ${initError.message}. Check /api/debug/status?key=YOUR_DEBUG_KEY for details.`,
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const decoded = await auth.verifyIdToken(req.body.idToken);
      const { role, displayName } = sanitizeObject(req.body);

      const existing = await db.collection('users').doc(decoded.uid).get();
      if (existing.exists) {
        return res.status(409).json({ error: 'User already registered' });
      }

      const isAdmin = ADMIN_EMAILS.includes((decoded.email || '').toLowerCase());

      const userDoc = {
        uid: decoded.uid,
        email: decoded.email,
        displayName,
        role: isAdmin ? 'admin' : role,
        active: true,
        createdAt: new Date().toISOString(),
      };

      await db.collection('users').doc(decoded.uid).set(userDoc);

      const profileCollection = role === 'influencer' ? 'influencers' : 'brands';
      if (!isAdmin) {
        await db.collection(profileCollection).doc(decoded.uid).set({
          uid: decoded.uid,
          displayName,
          createdAt: new Date().toISOString(),
        });
      }

      res.status(201).json({ user: userDoc });
    } catch (err) {
      // Forward to the central error handler in server.js, which logs
      // the full stack and (with DEBUG_MODE=true) returns err.message
      // to the client so you can see the real cause immediately.
      next(err);
    }
  }
);

/** GET /api/auth/me - returns the logged-in user's profile + role */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
