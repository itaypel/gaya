const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');

// Push subscriptions live in the same private store as orders.
const SUBS_PATH = 'push-subscriptions.json';

async function readSubs() {
  const result = await get(SUBS_PATH, { access: 'private', useCache: false });
  if (!result) return { subs: [], etag: null };
  const text = await new Response(result.stream).text();
  const subs = JSON.parse(text);
  return { subs: Array.isArray(subs) ? subs : [], etag: result.blob ? result.blob.etag : null };
}

async function writeSubs(subs, etag) {
  const putOptions = {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  };
  if (etag) putOptions.ifMatch = etag;
  await put(SUBS_PATH, JSON.stringify(subs), putOptions);
}

async function addSub(sub) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { subs, etag } = await readSubs();
    const next = subs.filter((s) => s.endpoint !== sub.endpoint);
    next.push(sub);
    try {
      await writeSubs(next, etag);
      return;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError && attempt < 3) continue;
      throw err;
    }
  }
}

async function removeSubs(endpoints) {
  if (endpoints.length === 0) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { subs, etag } = await readSubs();
    const next = subs.filter((s) => !endpoints.includes(s.endpoint));
    if (next.length === subs.length) return;
    try {
      await writeSubs(next, etag);
      return;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError && attempt < 3) continue;
      throw err;
    }
  }
}

module.exports = { readSubs, addSub, removeSubs };
