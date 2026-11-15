const { Redis } = require('@upstash/redis');

// Orders and push subscriptions hold customer details, so they live in a
// private Upstash Redis database (added through the Vercel Marketplace). It is
// reachable only with the token in the server's environment, never from the
// browser. The Marketplace sets KV_REST_API_*; a database connected by hand
// uses UPSTASH_REDIS_REST_*, so either works.
let client = null;

function redis() {
  if (client) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis is not configured');
  client = new Redis({ url, token });
  return client;
}

module.exports = { redis };
