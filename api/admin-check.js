const { requireAdmin } = require('./_auth');

// The staff gate posts the typed passcode here; only the server knows the
// right one.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;
  res.status(200).json({ ok: true });
};
