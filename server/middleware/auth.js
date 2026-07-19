const { auth, db, initError } = require('../utils/firebaseAdmin');

async function requireAuth(req, res, next) {
  if (initError) {
    console.error('[requireAuth] Firebase Admin never initialized:', initError.message);
    return res.status(500).json({
      error: `Firebase Admin failed to initialize: ${initError.message}. Check /api/debug/status?key=YOUR_DEBUG_KEY for details.`,
    });
  }

  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.split(' ')[1] : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    const decoded = await auth.verifyIdToken(token);
    const userDoc = await db.collection('users').doc(decoded.uid).get();

    if (!userDoc.exists) {
      return res.status(403).json({ error: 'No user profile found. Please complete signup.' });
    }

    const userData = userDoc.data();

    // An admin can deactivate an account from the admin dashboard; once
    // deactivated, every authenticated route should refuse that user,
    // not just hide the button in the UI.
    if (userData.active === false) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact support.' });
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      ...userData,
    };

    next();
  } catch (err) {
    // Log the *real* reason token verification failed — this is often
    // "Firebase ID token has invalid signature" (client/admin project
    // mismatch) or "Decoding Firebase ID token failed" (clock skew,
    // malformed token) rather than a generic auth failure.
    console.error('[requireAuth] Token verification failed:', err.code || '', err.message);
    return res.status(401).json({ error: 'Invalid or expired token', detail: err.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
