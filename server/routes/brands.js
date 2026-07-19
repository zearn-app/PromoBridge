const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');

const router = express.Router();

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const doc = await db.collection('brands').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Brand not found' });
    res.json({ brand: { id: doc.id, ...doc.data() } });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/profile/update',
  requireAuth,
  requireRole('brand'),
  [
    body('companyName')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 120 })
      .withMessage('Company name must be 120 characters or fewer'),
    body('industry').optional({ checkFalsy: true }).trim(),
    body('budget')
      .optional({ checkFalsy: true })
      .isFloat({ min: 0 })
      .withMessage('Budget must be a positive number'),
    // Was isURL() with strict defaults (requires a valid-looking domain
    // with a TLD), which rejected perfectly reasonable input like a
    // relative path, a URL without "https://", or an image data URI.
    // checkFalsy means an empty string is treated as "not provided"
    // instead of being run through the URL check at all.
    body('logoUrl')
      .optional({ checkFalsy: true })
      .trim()
      .isURL({ require_protocol: false, require_tld: false })
      .withMessage('Logo URL doesn\'t look like a valid link'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const clean = sanitizeObject(req.body);
      delete clean.uid;

      await db.collection('brands').doc(req.user.uid).set(
        { ...clean, updatedAt: new Date().toISOString() },
        { merge: true }
      );

      res.json({ message: 'Profile updated' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
