const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');

// Orders contain customer PII, so they live in their own private Blob store
// (access: 'private' — requires an authenticated request, unlike the public
// store used for the product catalog/images). Reads and writes below use
// this store's dedicated BLOB_READ_WRITE_TOKEN automatically.
const ORDERS_PATH = 'orders.json';
const MAX_ORDERS = 500;

async function readOrders() {
  const result = await get(ORDERS_PATH, { access: 'private', useCache: false });
  if (!result) return { orders: [], etag: null };
  const text = await new Response(result.stream).text();
  const orders = JSON.parse(text);
  return { orders: Array.isArray(orders) ? orders : [], etag: result.blob ? result.blob.etag : null };
}

async function appendOrder(order) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { orders, etag } = await readOrders();
    const next = [order, ...orders].slice(0, MAX_ORDERS);
    const putOptions = {
      access: 'private',
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
