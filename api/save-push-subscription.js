const { addSub } = require('./_push-store');

const MAX_BYTES = 4 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const passcode = req.headers['x-admin-passcode'];
  if (!passcode || passcode !== process.env.ADMIN_GATE_PASSCODE) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

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

  let sub;
  try {
    sub = JSON.parse(body.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'invalid json' });
    return;
  }

  const validKeys = sub && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint || !validKeys) {
    res.status(400).json({ error: 'invalid subscription' });
    return;
  }

  try {
    await addSub({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'save failed', detail: String(err && err.message || err) });
  }
};
