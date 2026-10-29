const crypto = require('crypto');
const { getFile, putFile, GitHubConflictError } = require('./_github');
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

  // Every upload is resized and re-encoded, not just HEIC: photos straight
  // off a phone are several hundred KB each, and every one is committed to
  // the repo and downloaded by every visitor.
  let outBuffer;
  try {
    const source = isHeic ? await convertHeic({ buffer: body, format: 'JPEG', quality: 0.9 }) : body;
    outBuffer = await sharp(source).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (err) {
    res.status(422).json({ error: isHeic ? 'heic conversion failed' : 'image processing failed', detail: String(err && err.message || err) });
    return;
  }

  // Photos are committed into the repo and served with the site. Gallery
  // photos get a fresh, never-reused name per upload. Story images overwrite
  // their fixed path, which the page references by name. Until the deploy
  // the commit triggers is live, vercel.json proxies a not-yet-deployed photo
  // from GitHub so the panel can show it right away.
  const unique = req.query.unique === '1';
  const name = unique ? `${id}-${crypto.randomBytes(9).toString('base64url')}.jpg` : `${id}.jpg`;
  const path = 'assets/images/products/' + name;
  try {
    const existing = unique ? null : await getFile(path);
    await putFile(path, outBuffer, 'Admin panel: upload photo ' + name, existing && existing.sha);
    res.status(200).json({ url: '/' + path });
  } catch (err) {
    if (err instanceof GitHubConflictError) {
      res.status(503).json({ error: 'upload failed', detail: 'concurrent update, retry' });
      return;
    }
    res.status(500).json({ error: 'upload failed', detail: String(err && err.message || err) });
  }
};
