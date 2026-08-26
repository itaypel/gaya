const { put } = require('@vercel/blob');

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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

  const id = String(req.query.id || '');
  if (!/^[a-z][a-z0-9]{0,15}$/.test(id)) {
    res.status(400).json({ error: 'invalid product id' });
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (!ALLOWED_TYPES.includes(contentType)) {
    res.status(400).json({ error: 'unsupported image type' });
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
  }).catch((err) => {
    if (err && err.message === 'too_large') { res.status(413).json({ error: 'image too large' }); }
    else { res.status(400).json({ error: 'read failed' }); }
    return null;
  });
  if (body === null) return;
  if (body.length === 0) {
    res.status(400).json({ error: 'empty upload' });
    return;
  }

  try {
    const blob = await put(`products/${id}.jpg`, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      cacheControlMaxAge: 300,
    });
    res.status(200).json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: 'upload failed', detail: String(err && err.message || err) });
  }
};
