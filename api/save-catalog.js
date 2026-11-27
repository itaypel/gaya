const { requireAdmin } = require('./_auth');
const { getFile, putFile, GitHubConflictError } = require('./_github');

const MAX_BYTES = 200 * 1024;
const DATA_PATH = 'js/saved-data.js';
const HEADER = '// Written by the admin panel (api/save-catalog.js commits this file on every\n' +
  '// save) — prices, texts, stock, photos and added/removed products, merged over\n' +
  '// the CATALOG/STOCK/SITE defaults in data.js. Edit it by hand only with care.\n';

// saved-data.js is a script, not JSON, so the page can load it without a
// fetch: pull the object literal back out of `const SAVED_DATA = {...};`.
function parseSaved(buf) {
  const text = buf.toString('utf8');
  const start = text.indexOf('{', text.indexOf('const SAVED_DATA'));
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

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

// Pot colors for boutique plants: [{id, label, hex, img?}]. ids end up in cart and
// order keys, so they stay short; bad or duplicate entries are dropped.
const MAX_POT_COLORS = 20;
const POT_IMG_RE = /^\/assets\/images\/(pots|products)\/[A-Za-z0-9_-]{1,64}\.jpg$/;
function sanitizePotColors(input) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(input)) return out;
  for (const c of input) {
    if (out.length >= MAX_POT_COLORS) break;
    if (!c || typeof c !== 'object') continue;
    const id = typeof c.id === 'string' ? c.id : '';
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    const hex = typeof c.hex === 'string' ? c.hex : '';
    if (!/^[a-z0-9]{1,16}$/.test(id) || seen.has(id)) continue;
    if (!label || label.length > 40) continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
    seen.add(id);
    // Optional photo of the pot: only a site-local path (the shipped pots/
    // folder or an admin upload in products/), never an arbitrary URL.
    const img = typeof c.img === 'string' ? c.img : '';
    out.push(POT_IMG_RE.test(img) ? { id, label, hex, img } : { id, label, hex });
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!(await requireAdmin(req, res))) return;

  // GET hands the admin panel what's on main right now — newer than the
  // deployed saved-data.js for the minute or so a deploy takes.
  if (req.method === 'GET') {
    try {
      const file = await getFile(DATA_PATH);
      res.status(200).json(file ? parseSaved(file.content) : { version: 0 });
    } catch (err) {
      res.status(500).json({ error: 'load failed', detail: String(err && err.message || err) });
    }
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

  // The version number makes a stale panel fail loudly instead of silently
  // undoing a save made from another tab or device: the write only lands if
  // the client last saw exactly the version on main, and GitHub's own sha
  // check covers two writes racing each other.
  try {
    const file = await getFile(DATA_PATH);
    const current = file ? parseSaved(file.content) : { version: 0 };
    const seen = req.headers['x-catalog-version'];
    if (seen !== undefined && Number(seen) !== Number(current.version || 0)) {
      res.status(409).json({ error: 'conflict' });
      return;
    }
    // A client that doesn't send potColors (an older open panel) keeps the
    // saved list instead of wiping it.
    if (Array.isArray(data.potColors)) payload.potColors = sanitizePotColors(data.potColors);
    else if (Array.isArray(current.potColors)) payload.potColors = current.potColors;
    const version = Number(current.version || 0) + 1;
    const content = HEADER + 'const SAVED_DATA = ' + JSON.stringify(Object.assign({ version }, payload), null, 2) + ';\n';
    await putFile(DATA_PATH, content, 'Admin panel: update catalog and site texts (v' + version + ')', file && file.sha);
    res.status(200).json({ version });
  } catch (err) {
    if (err instanceof GitHubConflictError) {
      res.status(409).json({ error: 'conflict' });
      return;
    }
    res.status(500).json({ error: 'save failed', detail: String(err && err.message || err) });
  }
};
