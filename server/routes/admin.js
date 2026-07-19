const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../utils/firebaseAdmin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pushNotification } = require('../utils/notify');
const { logAdminAction } = require('../utils/auditLog');

const router = express.Router();

// Every route in this file requires an authenticated admin
router.use(requireAuth, requireRole('admin'));

/** GET /api/admin/overview - platform totals for the dashboard header */
router.get('/overview', async (req, res) => {
  try {
    const [paymentsSnap, withdrawalsSnap, usersSnap, reportsSnap] = await Promise.all([
      db.collection('payments').get(),
      db.collection('withdrawals').where('status', '==', 'pending').get(),
      db.collection('users').get(),
      db.collection('reports').where('status', '==', 'open').get(),
    ]);

    const payments = paymentsSnap.docs.map((d) => d.data());
    const totalCollected = payments.filter((p) => p.status !== 'created').reduce((s, p) => s + (p.amount || 0), 0);
    const totalCommission = payments.filter((p) => p.status !== 'created').reduce((s, p) => s + (p.commissionAmount || 0), 0);
    const users = usersSnap.docs.map((d) => d.data());

    res.json({
      totalCollected,
      totalCommission,
      pendingWithdrawals: withdrawalsSnap.size,
      totalUsers: usersSnap.size,
      activeUsers: users.filter((u) => u.active !== false).length,
      openReports: reportsSnap.size,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

/* ============================================================
   USERS — search, filter, and a full per-user detail view
   ============================================================ */

/** GET /api/admin/users?role=&status=&search= */
router.get('/users', async (req, res) => {
  try {
    const { role, status, search } = req.query;
    const snap = await db.collection('users').get();
    let users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (role) users = users.filter((u) => u.role === role);
    if (status === 'active') users = users.filter((u) => u.active !== false);
    if (status === 'deactivated') users = users.filter((u) => u.active === false);
    if (search) {
      const q = search.toLowerCase();
      users = users.filter(
        (u) => (u.displayName || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
      );
    }

    users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/admin/users/:id
 * Full detail for one user: their profile doc, plus every campaign,
 * request, payment, and withdrawal touching them — so admin doesn't
 * have to cross-reference collections by hand to resolve a dispute.
 */
router.get('/users/:id', async (req, res) => {
  try {
    const uid = req.params.id;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: userDoc.id, ...userDoc.data() };

    const profileCollection = user.role === 'brand' ? 'brands' : user.role === 'influencer' ? 'influencers' : null;
    const profileDoc = profileCollection ? await db.collection(profileCollection).doc(uid).get() : null;

    const idField = user.role === 'brand' ? 'brandId' : 'influencerId';

    const [requestsSnap, paymentsSnap, withdrawalsSnap, campaignsSnap, reportsAgainstSnap] = await Promise.all([
      user.role === 'brand' || user.role === 'influencer'
        ? db.collection('requests').where(idField, '==', uid).get()
        : Promise.resolve({ docs: [] }),
      user.role === 'brand' || user.role === 'influencer'
        ? db.collection('payments').where(idField, '==', uid).get()
        : Promise.resolve({ docs: [] }),
      user.role === 'influencer' ? db.collection('withdrawals').where('influencerId', '==', uid).get() : Promise.resolve({ docs: [] }),
      user.role === 'brand' ? db.collection('campaigns').where('brandId', '==', uid).get() : Promise.resolve({ docs: [] }),
      db.collection('reports').where('againstUid', '==', uid).get(),
    ]);

    res.json({
      user,
      profile: profileDoc && profileDoc.exists ? { id: profileDoc.id, ...profileDoc.data() } : null,
      requests: requestsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      payments: paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      withdrawals: withdrawalsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      campaigns: campaignsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      reportsAgainst: reportsAgainstSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load user detail' });
  }
});

/** PATCH /api/admin/users/:id/status - deactivate or reactivate an account */
router.patch('/users/:id/status', [body('active').isBoolean()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    await db.collection('users').doc(req.params.id).update({ active: req.body.active });
    await logAdminAction({
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      action: req.body.active ? 'reactivate_user' : 'deactivate_user',
      targetType: 'user',
      targetId: req.params.id,
    });
    res.json({ message: `User ${req.body.active ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

/** PATCH /api/admin/users/:id/role - change a user's role (e.g. promote to admin) */
router.patch('/users/:id/role', [body('role').isIn(['influencer', 'brand', 'admin'])], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const ref = db.collection('users').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const previousRole = doc.data().role;
    await ref.update({ role: req.body.role });
    await logAdminAction({
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      action: 'change_role',
      targetType: 'user',
      targetId: req.params.id,
      details: { from: previousRole, to: req.body.role },
    });
    res.json({ message: `Role updated to ${req.body.role}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/** DELETE /api/admin/users/:id - permanently delete an account */
router.delete('/users/:id', async (req, res) => {
  try {
    const { auth } = require('../utils/firebaseAdmin');
    await db.collection('users').doc(req.params.id).delete();
    await auth.deleteUser(req.params.id).catch(() => {}); // ignore if already gone
    await logAdminAction({
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      action: 'delete_user',
      targetType: 'user',
      targetId: req.params.id,
    });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/* ============================================================
   PAYMENTS
   ============================================================ */

/** GET /api/admin/payments - all payments with status, for verification */
router.get('/payments', async (req, res) => {
  const snap = await db.collection('payments').get();
  const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ payments });
});

/** PATCH /api/admin/payments/:id/release - verify delivery, release the creator's share */
router.patch('/payments/:id/release', async (req, res) => {
  try {
    const ref = db.collection('payments').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Payment not found' });

    await ref.update({ status: 'released', releasedAt: new Date().toISOString(), releasedBy: req.user.uid });

    await pushNotification({
      toUid: doc.data().influencerId,
      title: 'Funds released',
      body: `Your earnings of ₹${doc.data().influencerShare} are now available for withdrawal.`,
      data: { type: 'funds_released', paymentId: req.params.id },
    });

    await logAdminAction({
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      action: 'release_payment',
      targetType: 'payment',
      targetId: req.params.id,
      details: { influencerShare: doc.data().influencerShare },
    });

    res.json({ message: 'Payment released to influencer balance' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release payment' });
  }
});

/* ============================================================
   WITHDRAWALS
   ============================================================ */

/** GET /api/admin/withdrawals - pending + historical withdrawal requests */
router.get('/withdrawals', async (req, res) => {
  const snap = await db.collection('withdrawals').get();
  const withdrawals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  withdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ withdrawals });
});

/** PATCH /api/admin/withdrawals/:id - approve or reject a payout request */
router.patch('/withdrawals/:id', [body('status').isIn(['approved', 'rejected'])], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const ref = db.collection('withdrawals').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Withdrawal not found' });

    await ref.update({
      status: req.body.status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user.uid,
    });

    await pushNotification({
      toUid: doc.data().influencerId,
      title: `Withdrawal ${req.body.status}`,
      body:
        req.body.status === 'approved'
          ? 'Your withdrawal was approved. Admin will transfer funds manually.'
          : 'Your withdrawal request was rejected. Contact support for details.',
      data: { type: 'withdrawal_update', withdrawalId: req.params.id },
    });

    await logAdminAction({
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      action: req.body.status === 'approved' ? 'approve_withdrawal' : 'reject_withdrawal',
      targetType: 'withdrawal',
      targetId: req.params.id,
      details: { amount: doc.data().amount, influencerId: doc.data().influencerId },
    });

    res.json({ message: `Withdrawal ${req.body.status}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update withdrawal' });
  }
});

/* ============================================================
   TRANSACTION LEDGER — payments + withdrawals, one unified feed
   ============================================================ */

/** GET /api/admin/transactions - every payment and withdrawal, merged and sorted, for a single audit view */
router.get('/transactions', async (req, res) => {
  try {
    const [paymentsSnap, withdrawalsSnap] = await Promise.all([
      db.collection('payments').get(),
      db.collection('withdrawals').get(),
    ]);

    const payments = paymentsSnap.docs.map((d) => ({
      id: d.id,
      kind: 'payment',
      ...d.data(),
    }));
    const withdrawals = withdrawalsSnap.docs.map((d) => ({
      id: d.id,
      kind: 'withdrawal',
      ...d.data(),
    }));

    const transactions = [...payments, ...withdrawals].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load transaction ledger' });
  }
});

/* ============================================================
   REPORTS — disputes/flags filed by brands or influencers
   ============================================================ */

/** GET /api/admin/reports */
router.get('/reports', async (req, res) => {
  try {
    const { status } = req.query;
    let query = db.collection('reports');
    if (status) query = query.where('status', '==', status);
    const snap = await query.get();
    const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

/** PATCH /api/admin/reports/:id - resolve or dismiss a report */
router.patch('/reports/:id', [body('status').isIn(['resolved', 'dismissed'])], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const ref = db.collection('reports').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Report not found' });

    await ref.update({
      status: req.body.status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user.uid,
    });

    await logAdminAction({
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      action: req.body.status === 'resolved' ? 'resolve_report' : 'dismiss_report',
      targetType: 'report',
      targetId: req.params.id,
    });

    res.json({ message: `Report ${req.body.status}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update report' });
  }
});

/* ============================================================
   COMMISSION SETTINGS
   ============================================================ */

/** PATCH /api/admin/commission - adjust the platform-wide commission percentage */
router.patch('/commission', [body('percent').isFloat({ min: 0, max: 100 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const settingsRef = db.collection('settings').doc('commission');
  const before = await settingsRef.get();

  await settingsRef.set({
    percent: Number(req.body.percent),
    updatedBy: req.user.uid,
    updatedAt: new Date().toISOString(),
  });

  await logAdminAction({
    adminUid: req.user.uid,
    adminEmail: req.user.email,
    action: 'update_commission',
    targetType: 'settings',
    targetId: 'commission',
    details: { from: before.exists ? before.data().percent : null, to: Number(req.body.percent) },
  });

  res.json({ message: 'Commission rate updated' });
});

/** GET /api/admin/commission - current commission percentage */
router.get('/commission', async (req, res) => {
  const doc = await db.collection('settings').doc('commission').get();
  res.json({ percent: doc.exists ? Number(doc.data().percent) : Number(process.env.DEFAULT_COMMISSION_PERCENT || 15) });
});

/* ============================================================
   AUDIT LOG — read-only trail of every admin action above
   ============================================================ */

/** GET /api/admin/audit-log */
router.get('/audit-log', async (req, res) => {
  try {
    const snap = await db.collection('audit_logs').get();
    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ logs: logs.slice(0, 200) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

module.exports = router;
