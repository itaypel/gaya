const { readOrders } = require('./_orders-store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const passcode = req.headers['x-admin-passcode'];
  if (!passcode || passcode !== process.env.ADMIN_GATE_PASSCODE) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const { orders } = await readOrders();
    res.status(200).json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'list failed', detail: String(err && err.message || err) });
  }
};
