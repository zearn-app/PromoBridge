const express = require('express');
const { body, validationResult } = require('express-validator');
const { db, admin } = require('../utils/firebaseAdmin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');
const { pushNotification } = require('../utils/notify');

const router = express.Router();

/**
 * POST /api/requests
 * A brand sends a promotion request to a specific influencer, optionally
 * tied to an existing campaign. Creates an in-app notification for the
 * influencer and attempts a push via FCM if they have a device token.
 */
router.post(
  '/',
  requireAuth,
  requireRole('brand'),
  [
    body('influencerId').notEmpty(),
    body('amount').isFloat({ min: 0 }),
    body('message').optional().isLength({ max: 1000 }),
    body('campaignId').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const clean = sanitizeObject(req.body);
      const influencerSnap = await db.collection('influencers').doc(clean.influencerId).get();
      if (!influencerSnap.exists) return res.status(404).json({ error: 'Influencer not found' });

      const requestDoc = {
        brandId: req.user.uid,
        influencerId: clean.influencerId,
        campaignId: clean.campaignId || null,
        amount: Number(clean.amount),
        message: clean.message || '',
        status: 'pending', // pending | accepted | declined | completed
        createdAt: new Date().toISOString(),
      };

      const ref = await db.collection('requests').add(requestDoc);

      await pushNotification({
        toUid: clean.influencerId,
        title: 'New promotion request',
        body: `${req.user.displayName || 'A brand'} sent you a campaign request.`,
        data: { type: 'new_request', requestId: ref.id },
      });

      res.status(201).json({ id: ref.id, request: requestDoc });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to send request' });
    }
  }
);

/** GET /api/requests/mine - all requests relevant to the logged-in user */
router.get('/mine/list', requireAuth, async (req, res) => {
  try {
    const field = req.user.role === 'brand' ? 'brandId' : 'influencerId';
    const snap = await db.collection('requests').where(field, '==', req.user.uid).get();
    const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/** PATCH /api/requests/:id - influencer accepts or declines */
router.patch(
  '/:id',
  requireAuth,
  requireRole('influencer'),
  [body('status').isIn(['accepted', 'declined'])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const ref = db.collection('requests').doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'Request not found' });
      if (doc.data().influencerId !== req.user.uid) {
        return res.status(403).json({ error: 'Not your request to update' });
      }

      await ref.update({ status: req.body.status, respondedAt: new Date().toISOString() });

      await pushNotification({
        toUid: doc.data().brandId,
        title: `Request ${req.body.status}`,
        body: `Your promotion request was ${req.body.status} by the influencer.`,
        data: { type: 'request_update', requestId: ref.id },
      });

      res.json({ message: `Request ${req.body.status}` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update request' });
    }
  }
);

module.exports = router;
