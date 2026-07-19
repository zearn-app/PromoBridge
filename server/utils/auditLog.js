const { db } = require('./firebaseAdmin');

/**
 * Records an admin action to the `audit_logs` collection so every
 * mutating thing an admin does (release funds, approve a withdrawal,
 * change commission, deactivate/delete a user, resolve a report) has
 * a permanent, reviewable paper trail — surfaced in the admin
 * dashboard's Audit Log tab.
 *
 * Never throws: an audit-log failure should never block the actual
 * admin action from completing.
 */
async function logAdminAction({ adminUid, adminEmail, action, targetType, targetId, details = {} }) {
  try {
    await db.collection('audit_logs').add({
      adminUid,
      adminEmail: adminEmail || null,
      action, // e.g. 'release_payment', 'approve_withdrawal', 'reject_withdrawal',
              // 'update_commission', 'deactivate_user', 'reactivate_user',
              // 'delete_user', 'resolve_report', 'dismiss_report'
      targetType, // 'payment' | 'withdrawal' | 'user' | 'report' | 'settings'
      targetId: targetId || null,
      details,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[auditLog] Failed to record action:', err.message);
  }
}

module.exports = { logAdminAction };
