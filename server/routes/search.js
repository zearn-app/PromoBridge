const express = require('express');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/search?q=&category=&platform=&minBudget=&maxBudget=&location=
 * Unified search across campaigns and influencers by keyword plus the
 * filters the Home/Search pages expose. Firestore only indexes exact
 * equality well, so keyword matching happens in-memory — fine at this
 * project's scale (free-tier, small collections).
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q, category, platform, minBudget, maxBudget, location } = req.query;
    const keyword = (q || '').toLowerCase().trim();

    const [campaignsSnap, influencersSnap] = await Promise.all([
      db.collection('campaigns').where('status', '==', 'open').get(),
      db.collection('influencers').get(),
    ]);

    let campaigns = campaignsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let influencers = influencersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (keyword) {
      campaigns = campaigns.filter((c) =>
        [c.title, c.description, c.category, c.industry, c.targetAudience]
          .filter(Boolean)
          .some((f) => f.toLowerCase().includes(keyword))
      );
      influencers = influencers.filter((i) =>
        [i.displayName, i.bio, i.niche, i.location]
          .filter(Boolean)
          .some((f) => f.toLowerCase().includes(keyword))
      );
    }
    if (category) campaigns = campaigns.filter((c) => (c.category || '').toLowerCase() === category.toLowerCase());
    if (platform) {
      campaigns = campaigns.filter((c) => (c.platform || '').toLowerCase() === platform.toLowerCase());
      influencers = influencers.filter((i) => (i.platform || '').toLowerCase() === platform.toLowerCase());
    }
    if (minBudget) campaigns = campaigns.filter((c) => Number(c.budget) >= Number(minBudget));
    if (maxBudget) campaigns = campaigns.filter((c) => Number(c.budget) <= Number(maxBudget));
    if (location) influencers = influencers.filter((i) => (i.location || '').toLowerCase().includes(location.toLowerCase()));

    res.json({ campaigns, influencers });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
