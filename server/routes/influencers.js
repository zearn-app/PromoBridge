const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { niche, minFollowers, maxFollowers, location } = req.query;
    let query = db.collection('influencers');

    if (niche) query = query.where('niche', '==', niche);
    if (location) query = query.where('location', '==', location);

    const snap = await query.get();
    let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (minFollowers) results = results.filter(i => (i.followerCount || 0) >= Number(minFollowers));
    if (maxFollowers) results = results.filter(i => (i.followerCount || 0) <= Number(maxFollowers));

    res.json({ influencers: results });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const doc = await db.collection('influencers').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Influencer not found' });
    res.json({ influencer: { id: doc.id, ...doc.data() } });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/profile/update',
  requireAuth,
  requireRole('influencer'),
  [
    body('bio').optional().isLength({ max: 1000 }),
    body('niche').optional().trim(),
    body('followerCount').optional().isInt({ min: 0 }),
    body('location').optional().trim(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const clean = sanitizeObject(req.body);
      delete clean.uid;

      await db.collection('influencers').doc(req.user.uid).set(
        { ...clean, updatedAt: new Date().toISOString() },
        { merge: true }
      );

      res.json({ message: 'Profile updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/gallery/add', requireAuth, requireRole('influencer'), async (req, res, next) => {
  try {
    const item = sanitizeObject({
      url: req.body.url,
      type: req.body.type,
      caption: req.body.caption || '',
      addedAt: new Date().toISOString(),
    });

    if (!item.url) return res.status(400).json({ error: 'url is required' });

    await db.collection('influencers').doc(req.user.uid).update({
      gallery: require('firebase-admin').firestore.FieldValue.arrayUnion(item),
    });

    res.json({ message: 'Gallery item added', item });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
