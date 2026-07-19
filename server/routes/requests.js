const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
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
        // Order pipeline: pending -> accepted -> in_progress -> completed
        // (or declined at the first step, cancelled at any step before completed)
        status: 'pending',
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

/** PATCH /api/requests/:id - influencer accepts or declines a pending request */
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
      if (doc.data().status !== 'pending') {
        return res.status(400).json({ error: 'This request has already been responded to' });
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

/**
 * PATCH /api/requests/:id/progress
 * Moves an accepted order through its delivery pipeline. The brand
 * marks work as started and then completed; either side can cancel
 * before completion (e.g. the deal falls through).
 *   accepted    -> in_progress   (brand only)
 *   in_progress -> completed     (brand only)
 *   pending/accepted/in_progress -> cancelled (either party)
 */
router.patch(
  '/:id/progress',
  requireAuth,
  [body('status').isIn(['in_progress', 'completed', 'cancelled'])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const ref = db.collection('requests').doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'Request not found' });

      const request = doc.data();
      const isBrand = request.brandId === req.user.uid;
      const isInfluencer = request.influencerId === req.user.uid;
      if (!isBrand && !isInfluencer) return res.status(403).json({ error: 'Not your request to update' });

      const target = req.body.status;

      if (target === 'cancelled') {
        if (!['pending', 'accepted', 'in_progress'].includes(request.status)) {
          return res.status(400).json({ error: `Cannot cancel a request that is already ${request.status}` });
        }
      } else {
        if (!isBrand) return res.status(403).json({ error: 'Only the brand can advance order progress' });
        if (target === 'in_progress' && request.status !== 'accepted') {
          return res.status(400).json({ error: 'Order must be accepted before marking in progress' });
        }
        if (target === 'completed' && request.status !== 'in_progress') {
          return res.status(400).json({ error: 'Order must be in progress before marking complete' });
        }
      }

      await ref.update({ status: target, [`${target}At`]: new Date().toISOString() });

      const otherUid = isBrand ? request.influencerId : request.brandId;
      await pushNotification({
        toUid: otherUid,
        title: `Order ${target.replace('_', ' ')}`,
        body: `Your order status changed to "${target.replace('_', ' ')}".`,
        data: { type: 'request_update', requestId: ref.id },
      });

      res.json({ message: `Order marked ${target.replace('_', ' ')}` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update order progress' });
    }
  }
);

module.exports = router;
