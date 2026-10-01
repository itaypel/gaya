const { put, BlobPreconditionFailedError } = require('@vercel/blob');

const MAX_BYTES = 200 * 1024;

// Mirrors the SITE keys in js/data.js — an allowlist so this endpoint can
// only ever overwrite known site-copy fields, never arbitrary keys.
const SITE_KEYS = [
  'heroKicker', 'heroTitle', 'heroBody', 'heroCta1', 'heroCta2', 'careTitle', 'careSub',
  'storyKicker', 'storyTitle', 'storyIntro', 'storyFounders', 'kokedamaQ', 'kokedamaA',
  'beyondKicker', 'beyondTitle', 'beyondIntro',
  'series1H', 'series1B', 'series2H', 'series2B', 'series3H', 'series3B',
  'beyondClose', 'footer'
];
function sanitizeSite(input) {
  const out = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const k of SITE_KEYS) {
      if (typeof input[k] === 'string' && input[k].length <= 4000) out[k] = input[k];
    }
  }
  return out;
}

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
  }).catch((err) => {
    if (err && err.message === 'too_large') { res.status(413).json({ error: 'data too large' }); }
    else { res.status(400).json({ error: 'read failed' }); }
    return null;
  });
  if (body === null) return;

  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'invalid json' });
    return;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    res.status(400).json({ error: 'invalid payload shape' });
    return;
  }

  const payload = {
    edits: (data.edits && typeof data.edits === 'object' && !Array.isArray(data.edits)) ? data.edits : {},
    removed: (data.removed && typeof data.removed === 'object' && !Array.isArray(data.removed)) ? data.removed : {},
    stock: (data.stock && typeof data.stock === 'object' && !Array.isArray(data.stock)) ? data.stock : {},
    extra: Array.isArray(data.extra) ? data.extra : [],
    site: sanitizeSite(data.site)
  };

  // Vercel Blob enforces a 60s minimum cache, so a read can be briefly stale —
  // ifMatch turns that into a safe rejection instead of a silent lost update:
  // the write only lands if the blob is still exactly what this client last saw.
  const putOptions = {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    token: process.env.PRODUCTS_BLOB_TOKEN,
  };
  if (req.headers['x-catalog-etag']) putOptions.ifMatch = req.headers['x-catalog-etag'];

  try {
    const blob = await put('data/catalog.json', JSON.stringify(payload), putOptions);
    res.status(200).json({ url: blob.url, etag: blob.etag });
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) {
      res.status(409).json({ error: 'conflict' });
      return;
    }
    res.status(500).json({ error: 'save failed', detail: String(err && err.message || err) });
  }
};
