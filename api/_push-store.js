const { redis } = require('./_redis');

// Push subscriptions sit in one hash keyed by endpoint, so adding or removing
// one is a single write.
const SUBS = 'push-subs';

async function readSubs() {
  const all = await redis().hgetall(SUBS);
  const subs = Object.values(all || {}).map((v) => {
    if (v && typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
  }).filter(Boolean);
  return { subs };
}

async function addSub(sub) {
  await redis().hset(SUBS, { [sub.endpoint]: JSON.stringify(sub) });
}

async function removeSubs(endpoints) {
  if (endpoints.length === 0) return;
  await redis().hdel(SUBS, ...endpoints);
}

module.exports = { readSubs, addSub, removeSubs };
