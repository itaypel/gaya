const { put, BlobPreconditionFailedError } = require('@vercel/blob');

// Orders contain customer PII (name, phone, address). The project's Blob
// store is public-access-only (fixed at store creation), so instead of a
// predictable path like catalog.json, this uses a long random path segment
// as a capability secret — never shipped to client-side code — so the
// blob isn't discoverable or guessable the way the public catalog is.
const ORDERS_PATH = 'data/orders-e333f06b01565d1d2e70d6d1e675e018.json';
const ORDERS_URL = 'https://n5mm0fqiav7j7uht.public.blob.vercel-storage.com/' + ORDERS_PATH;
const MAX_ORDERS = 500;

async function readOrders() {
  const res = await fetch(ORDERS_URL, { cache: 'no-store' });
  if (res.status === 404) return { orders: [], etag: null };
  if (!res.ok) throw new Error('orders fetch failed: ' + res.status);
  const orders = await res.json();
  return { orders: Array.isArray(orders) ? orders : [], etag: res.headers.get('etag') || null };
}

async function appendOrder(order) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { orders, etag } = await readOrders();
    const next = [order, ...orders].slice(0, MAX_ORDERS);
    const putOptions = {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    };
    if (etag) putOptions.ifMatch = etag;
    try {
      await put(ORDERS_PATH, JSON.stringify(next), putOptions);
      return;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError && attempt < 3) continue;
      throw err;
    }
  }
}

module.exports = { readOrders, appendOrder };
