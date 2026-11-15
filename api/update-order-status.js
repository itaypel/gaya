const { requireAdmin } = require('./_auth');
const { setOrderState } = require('./_orders-store');

const VALID_STATES = ['new', 'prep', 'sent'];
const MAX_BYTES = 2 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!(await requireAdmin(req, res))) return;

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) { reject(new Error('too_large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  }).catch(() => null);
  if (body === null) { res.status(400).json({ error: 'read failed' }); return; }

  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'invalid json' });
    return;
  }

  if (typeof data.ref !== 'string' || !data.ref || !VALID_STATES.includes(data.state)) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }

  try {
    const found = await setOrderState(data.ref, data.state);
    if (!found) { res.status(404).json({ error: 'order not found' }); return; }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'update failed', detail: String(err && err.message || err) });
  }
};
