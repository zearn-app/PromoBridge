const express = require('express');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** GET /api/notifications/mine - the logged-in user's notifications, newest first */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('notifications').where('toUid', '==', req.user.uid).get();
    const notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/notifications/:id/read - mark one notification as read */
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const ref = db.collection('notifications').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Notification not found' });
    if (doc.data().toUid !== req.user.uid) return res.status(403).json({ error: 'Not your notification' });

    await ref.update({ read: true });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/notifications/read-all - mark every notification for this user as read */
router.patch('/read-all', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('notifications').where('toUid', '==', req.user.uid).where('read', '==', false).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
    res.json({ message: 'All notifications marked as read', count: snap.size });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
