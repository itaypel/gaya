const { redis } = require('./_redis');

// Each order is stored once, as JSON, in the ORDERS list (newest first, capped
// at MAX_ORDERS). Its state (new / prep / sent) lives apart in the STATES hash,
// so changing it is a single write that can't race with a new order coming in.
const ORDERS = 'orders';
const STATES = 'order-states';
const MAX_ORDERS = 500;

function parse(entry) {
  if (entry && typeof entry === 'object') return entry; // the client may decode JSON itself
  try { return JSON.parse(entry); } catch (e) { return null; }
}

async function readOrders() {
  const db = redis();
  const [entries, states] = await Promise.all([db.lrange(ORDERS, 0, MAX_ORDERS - 1), db.hgetall(STATES)]);
  const orders = entries.map(parse).filter(Boolean);
  for (const o of orders) {
    if (states && states[o.ref]) o.state = states[o.ref];
  }
  return { orders };
}

async function appendOrder(order) {
  await redis().multi()
    .lpush(ORDERS, JSON.stringify(order))
    .ltrim(ORDERS, 0, MAX_ORDERS - 1)
    .exec();
}

// Returns false when no stored order has this ref.
async function setOrderState(ref, state) {
  const { orders } = await readOrders();
  if (!orders.some((o) => o.ref === ref)) return false;
  await redis().hset(STATES, { [ref]: state });
  return true;
}

module.exports = { readOrders, appendOrder, setOrderState };
