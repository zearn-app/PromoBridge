const { db, admin } = require('./firebaseAdmin');

/**
 * Writes an in-app notification (always) and sends a Firebase Cloud
 * Messaging push (best-effort) if the recipient has registered an
 * FCM device token in users/{uid}.fcmToken. Free-tier FCM has no
 * usage limits worth worrying about for a project at this scale.
 */
async function pushNotification({ toUid, title, body, data = {} }) {
  try {
    await db.collection('notifications').add({
      toUid,
      title,
      body,
      data,
      read: false,
      createdAt: new Date().toISOString(),
    });

    const userDoc = await db.collection('users').doc(toUid).get();
    const token = userDoc.exists ? userDoc.data().fcmToken : null;

    if (token) {
      await admin.messaging().send({
        token,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      });
    }
  } catch (err) {
    // Notifications should never break the primary request flow
    console.error('Notification failed:', err.message);
  }
}

module.exports = { pushNotification };
