const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { sanitizeObject } = require('../utils/sanitize');
const { pushNotification } = require('../utils/notify');

const router = express.Router();

// Two people always land on the same conversationId regardless of who
// started it, by sorting their uids into a fixed order.
function conversationIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

/**
 * POST /api/messages
 * Sends a text message, optionally with an attachment URL (image/file/
 * link) and optionally tied to a specific request for context. There's
 * no persistent socket in this serverless setup, so the client polls
 * GET /api/messages/:conversationId every few seconds for new messages
 * rather than a true push — see messages.html.
 */
router.post(
  '/',
  requireAuth,
  [
    body('toUid').notEmpty(),
    body('text').trim().isLength({ min: 1, max: 2000 }),
    body('attachmentUrl').optional({ checkFalsy: true }).trim(),
    body('requestId').optional({ checkFalsy: true }).trim(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const clean = sanitizeObject(req.body);
      const conversationId = conversationIdFor(req.user.uid, clean.toUid);

      const message = {
        conversationId,
        participants: [req.user.uid, clean.toUid],
        fromUid: req.user.uid,
        toUid: clean.toUid,
        text: clean.text,
        attachmentUrl: clean.attachmentUrl || null,
        requestId: clean.requestId || null,
        read: false,
        createdAt: new Date().toISOString(),
      };

      const ref = await db.collection('messages').add(message);

      await pushNotification({
        toUid: clean.toUid,
        title: 'New message',
        body: clean.text.slice(0, 120),
        data: { type: 'new_message', conversationId },
      });

      res.status(201).json({ id: ref.id, message });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/messages/conversations
 * One row per conversation the user is part of, with the other
 * person's basic info and the most recent message — for the inbox list.
 */
router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('messages').where('participants', 'array-contains', req.user.uid).get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const byConversation = new Map();
    for (const m of all) {
      const existing = byConversation.get(m.conversationId);
      if (!existing || new Date(m.createdAt) > new Date(existing.createdAt)) {
        byConversation.set(m.conversationId, m);
      }
    }

    const conversations = await Promise.all(
      [...byConversation.values()].map(async (last) => {
        const otherUid = last.participants.find((p) => p !== req.user.uid);
        const otherDoc = await db.collection('users').doc(otherUid).get();
        const unread = all.filter(
          (m) => m.conversationId === last.conversationId && m.toUid === req.user.uid && !m.read
        ).length;

        return {
          conversationId: last.conversationId,
          otherUid,
          otherName: otherDoc.exists ? otherDoc.data().displayName : 'Unknown user',
          lastMessage: last.text,
          lastAt: last.createdAt,
          unread,
        };
      })
    );

    conversations.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

/** GET /api/messages/:conversationId - full thread, and marks incoming messages as read */
router.get('/:conversationId', requireAuth, async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    if (!conversationId.split('_').includes(req.user.uid)) {
      return res.status(403).json({ error: 'Not your conversation' });
    }

    const snap = await db.collection('messages').where('conversationId', '==', conversationId).get();
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const unread = snap.docs.filter((d) => d.data().toUid === req.user.uid && !d.data().read);
    if (unread.length) {
      const batch = db.batch();
      unread.forEach((d) => batch.update(d.ref, { read: true }));
      await batch.commit();
    }

    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
