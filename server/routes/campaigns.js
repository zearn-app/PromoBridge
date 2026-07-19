const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');

const router = express.Router();

/** POST /api/campaigns - a brand posts a new promotion request */
router.post(
  '/',
  requireAuth,
  requireRole('brand'),
  [
    body('title').trim().isLength({ min: 3, max: 120 }),
    body('description').trim().isLength({ min: 10, max: 2000 }),
    body('budget').isFloat({ min: 0 }),
    body('targetAudience').optional().trim(),
    body('timeline').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const clean = sanitizeObject(req.body);
      const campaign = {
        ...clean,
        brandId: req.user.uid,
        status: 'open', // open | in_progress | completed | closed
        createdAt: new Date().toISOString(),
      };

      const ref = await db.collection('campaigns').add(campaign);
      res.status(201).json({ id: ref.id, campaign });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create campaign' });
    }
  }
);

/** GET /api/campaigns - browse open campaigns (influencers filter by industry/budget/duration) */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { industry, minBudget, maxBudget } = req.query;
    let query = db.collection('campaigns').where('status', '==', 'open');
    const snap = await query.get();

    let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (minBudget) results = results.filter(c => Number(c.budget) >= Number(minBudget));
    if (maxBudget) results = results.filter(c => Number(c.budget) <= Number(maxBudget));
    if (industry) results = results.filter(c => (c.industry || '').toLowerCase() === industry.toLowerCase());

    res.json({ campaigns: results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

/** GET /api/campaigns/mine - a brand's own campaigns, for its dashboard */
router.get('/mine/list', requireAuth, requireRole('brand'), async (req, res) => {
  try {
    const snap = await db.collection('campaigns').where('brandId', '==', req.user.uid).get();
    const campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

/** PATCH /api/campaigns/:id/close - a brand closes their own campaign to new requests */
router.patch('/:id/close', requireAuth, requireRole('brand'), async (req, res) => {
  try {
    const ref = db.collection('campaigns').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });
    if (doc.data().brandId !== req.user.uid) {
      return res.status(403).json({ error: 'Not your campaign to close' });
    }
    await ref.update({ status: 'closed', closedAt: new Date().toISOString() });
    res.json({ message: 'Campaign closed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to close campaign' });
  }
});

module.exports = router;
