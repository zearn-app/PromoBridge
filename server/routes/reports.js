const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');

const router = express.Router();

/**
 * POST /api/reports
 * Any signed-in brand or influencer can flag a problem with the other
 * party on a specific request/campaign — a scam attempt, no-show,
 * abusive messages, etc. Lands in the admin dashboard's Reports tab
 * for manual review; never auto-actions an account.
 */
router.post(
  '/',
  requireAuth,
  [
    body('reason').trim().isLength({ min: 5, max: 500 }).withMessage('Please describe the issue in at least 5 characters'),
    body('againstUid').notEmpty().withMessage('Missing the user this report is about'),
    body('requestId').optional().trim(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const clean = sanitizeObject(req.body);
      const report = {
        reportedBy: req.user.uid,
        reportedByEmail: req.user.email || null,
        againstUid: clean.againstUid,
        requestId: clean.requestId || null,
        reason: clean.reason,
        status: 'open', // open | resolved | dismissed
        createdAt: new Date().toISOString(),
      };
      const ref = await db.collection('reports').add(report);
      res.status(201).json({ id: ref.id, report });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/reports/mine - reports the logged-in user has filed, so they can see status */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('reports').where('reportedBy', '==', req.user.uid).get();
    const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
