const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pushNotification } = require('../utils/notify');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function getCommissionPercent() {
  const doc = await db.collection('settings').doc('commission').get();
  return doc.exists ? Number(doc.data().percent) : Number(process.env.DEFAULT_COMMISSION_PERCENT || 15);
}

/**
 * POST /api/payments/create-order
 * A brand pays for an accepted request. We create a Razorpay order for
 * the FULL amount — the platform collects it, holds it, and the admin
 * manually releases the influencer's share after verifying the work.
 */
router.post(
  '/create-order',
  requireAuth,
  requireRole('brand'),
  [body('requestId').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const reqDoc = await db.collection('requests').doc(req.body.requestId).get();
      if (!reqDoc.exists) return res.status(404).json({ error: 'Request not found' });
      const requestData = reqDoc.data();

      if (requestData.brandId !== req.user.uid) {
        return res.status(403).json({ error: 'Not your request' });
      }
      if (requestData.status !== 'accepted') {
        return res.status(400).json({ error: 'Request must be accepted before payment' });
      }

      const amountPaise = Math.round(Number(requestData.amount) * 100);

      const order = await razorpay.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: `req_${req.body.requestId}`,
        notes: { requestId: req.body.requestId, brandId: req.user.uid, influencerId: requestData.influencerId },
      });

      const commissionPercent = await getCommissionPercent();
      const commissionAmount = +(Number(requestData.amount) * (commissionPercent / 100)).toFixed(2);
      const influencerShare = +(Number(requestData.amount) - commissionAmount).toFixed(2);

      const paymentDoc = {
        requestId: req.body.requestId,
        brandId: req.user.uid,
        influencerId: requestData.influencerId,
        amount: Number(requestData.amount),
        commissionPercent,
        commissionAmount,
        influencerShare,
        razorpayOrderId: order.id,
        status: 'created', // created | paid | released | rejected
        createdAt: new Date().toISOString(),
      };

      const paymentRef = await db.collection('payments').add(paymentDoc);

      res.json({
        paymentId: paymentRef.id,
        orderId: order.id,
        amount: amountPaise,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID, // safe to expose, used by Razorpay Checkout.js client-side
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create payment order' });
    }
  }
);

/**
 * POST /api/payments/verify
 * Called by the client after Razorpay Checkout succeeds. Verifies the
 * HMAC signature server-side (never trust the client) before marking
 * the payment as paid.
 */
router.post(
  '/verify',
  requireAuth,
  requireRole('brand'),
  [
    body('paymentId').notEmpty(),
    body('razorpay_order_id').notEmpty(),
    body('razorpay_payment_id').notEmpty(),
    body('razorpay_signature').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ error: 'Payment signature verification failed' });
      }

      const paymentRef = db.collection('payments').doc(paymentId);
      const paymentDoc = await paymentRef.get();
      if (!paymentDoc.exists) return res.status(404).json({ error: 'Payment record not found' });

      await paymentRef.update({
        status: 'paid',
        razorpayPaymentId: razorpay_payment_id,
        paidAt: new Date().toISOString(),
      });

      await db.collection('requests').doc(paymentDoc.data().requestId).update({ status: 'paid' });

      await pushNotification({
        toUid: paymentDoc.data().influencerId,
        title: 'Payment received',
        body: 'The brand has paid for your promotion. Funds will be released after admin verification.',
        data: { type: 'payment_received', paymentId },
      });

      res.json({ message: 'Payment verified successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Payment verification failed' });
    }
  }
);

/** GET /api/payments/mine/list - payment history for the logged-in user */
router.get('/mine/list', requireAuth, async (req, res) => {
  try {
    const field = req.user.role === 'brand' ? 'brandId' : 'influencerId';
    const snap = await db.collection('payments').where(field, '==', req.user.uid).get();
    res.json({ payments: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

/**
 * POST /api/payments/withdraw
 * Influencer requests payout of their released earnings. Admin approves
 * manually — no automated bank transfer, per platform design.
 */
router.post(
  '/withdraw',
  requireAuth,
  requireRole('influencer'),
  [body('amount').isFloat({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const withdrawal = {
        influencerId: req.user.uid,
        amount: Number(req.body.amount),
        status: 'pending', // pending | approved | rejected
        createdAt: new Date().toISOString(),
      };
      const ref = await db.collection('withdrawals').add(withdrawal);
      res.status(201).json({ id: ref.id, withdrawal });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit withdrawal request' });
    }
  }
);

/** GET /api/payments/withdraw/mine - the logged-in influencer's own withdrawal history */
router.get('/withdraw/mine', requireAuth, requireRole('influencer'), async (req, res) => {
  try {
    const snap = await db.collection('withdrawals').where('influencerId', '==', req.user.uid).get();
    const withdrawals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    withdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch withdrawal history' });
  }
});

module.exports = router;

