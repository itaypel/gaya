const { requireAdmin } = require('./_auth');
const { readOrders } = require('./_orders-store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { orders } = await readOrders();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'list failed', detail: String(err && err.message || err) });
  }
};
