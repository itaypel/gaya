const crypto = require('crypto');
const { redis } = require('./_redis');

// The staff passcode is checked only here, on the server, against
// ADMIN_GATE_PASSCODE. The browser never holds the right answer, only what
// the person typed.
//
// Wrong guesses are counted per IP in Redis: after MAX_FAILS within the
// window, that IP is refused until the window runs out, so the passcode
// can't be found by trying many in a row.
const MAX_FAILS = 8;
const WINDOW_SECONDS = 15 * 60;

function sameSecret(given, expected) {
  // Hashing first makes both sides the same length, so the comparison takes
  // the same time whatever was typed.
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return fwd.split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Returns true when the request carries the right passcode. Otherwise it has
// already sent 401 (wrong or missing), 429 (too many wrong guesses) or 500
// (server not configured), and the caller just returns.
async function requireAdmin(req, res) {
  const expected = process.env.ADMIN_GATE_PASSCODE;
  if (!expected) {
    res.status(500).json({ error: 'admin passcode not configured' });
    return false;
  }

  const key = 'auth-fail:' + clientIp(req);
  let db = null;
  try { db = redis(); } catch (e) { /* no Redis yet: check without the limit */ }

  if (db) {
    const fails = Number(await db.get(key).catch(() => 0)) || 0;
    if (fails >= MAX_FAILS) {
      res.status(429).json({ error: 'too many attempts' });
      return false;
    }
  }

  const given = req.headers['x-admin-passcode'];
  if (given && sameSecret(given, expected)) return true;

  if (db) {
    await db.multi().incr(key).expire(key, WINDOW_SECONDS).exec().catch(() => {});
  }
  res.status(401).json({ error: 'unauthorized' });
  return false;
}

module.exports = { requireAdmin };
