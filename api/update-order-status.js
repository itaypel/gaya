const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');

const ORDERS_PATH = 'orders.json';
const VALID_STATES = ['new', 'prep', 'sent'];
const MAX_BYTES = 2 * 1024;

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

  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await get(ORDERS_PATH, { access: 'private', useCache: false });
    if (!result) { res.status(404).json({ error: 'no orders yet' }); return; }
    const text = await new Response(result.stream).text();
    const orders = JSON.parse(text);
    const order = orders.find((o) => o.ref === data.ref);
    if (!order) { res.status(404).json({ error: 'order not found' }); return; }
    order.state = data.state;

    const putOptions = {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      ifMatch: result.blob ? result.blob.etag : undefined,
    };
    try {
      await put(ORDERS_PATH, JSON.stringify(orders), putOptions);
      res.status(200).json({ ok: true });
      return;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError && attempt < 3) continue;
      res.status(500).json({ error: 'update failed', detail: String(err && err.message || err) });
      return;
    }
  }
};
