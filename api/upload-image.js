const { put } = require('@vercel/blob');
const convertHeic = require('heic-convert');
const sharp = require('sharp');

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];

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
  const isHeic = HEIC_TYPES.includes(contentType);
  if (!ALLOWED_TYPES.includes(contentType) && !isHeic) {
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

  let outBuffer = body;
  if (isHeic) {
    try {
      const jpegBuffer = await convertHeic({ buffer: body, format: 'JPEG', quality: 0.9 });
      outBuffer = await sharp(jpegBuffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch (err) {
      res.status(422).json({ error: 'heic conversion failed', detail: String(err && err.message || err) });
      return;
    }
  }

  try {
    const blob = await put(`products/${id}.jpg`, outBuffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'image/jpeg',
      cacheControlMaxAge: 300,
    });
    res.status(200).json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: 'upload failed', detail: String(err && err.message || err) });
  }
};
