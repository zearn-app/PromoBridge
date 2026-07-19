const xss = require('xss');

/**
 * Recursively sanitizes all string values in an object to strip
 * script tags / HTML that could be used for XSS. Firestore is a
 * NoSQL document store, so classic SQL injection doesn't apply here,
 * but we still avoid ever building queries from raw unvalidated input.
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return xss(obj.trim());
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === 'object') {
    const clean = {};
    for (const key of Object.keys(obj)) {
      clean[key] = sanitizeObject(obj[key]);
    }
    return clean;
  }
  return obj;
}

module.exports = { sanitizeObject };
