const nodemailer = require('nodemailer');

const MAX_BYTES = 20 * 1024;
const NOTIFY_TO = 'giljabes22@gmail.com';

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
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
    if (err && err.message === 'too_large') { res.status(413).json({ error: 'payload too large' }); }
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

  const method = data.method === 'pickup' ? 'pickup' : 'ship';
  const items = Array.isArray(data.items) ? data.items.filter((it) =>
    it && isNonEmptyString(String(it.id || ''), 40) && isNonEmptyString(String(it.name || ''), 200) &&
    Number.isFinite(it.qty) && it.qty > 0 && Number.isFinite(it.price) && it.price >= 0
  ) : [];

  const valid = isNonEmptyString(data.name, 100) &&
    isNonEmptyString(data.phone, 40) &&
    items.length > 0 &&
    (method === 'pickup' || (isNonEmptyString(data.address, 200) && isNonEmptyString(data.city, 80)));
  if (!valid) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }

  const orderId = 'GY' + Date.now().toString(36).toUpperCase();
  const fmt = (n) => Number(n || 0).toLocaleString('he-IL') + ' ₪';
  const lines = items.map((it) => `  ${it.name} × ${it.qty} — ${fmt(it.price * it.qty)}`).join('\n');
  const emailStr = isNonEmptyString(data.email, 200) ? data.email.trim() : '';
  const text = [
    `הזמנה חדשה מהאתר #${orderId}`,
    '',
    `שם: ${data.name.trim()}`,
    `טלפון: ${data.phone.trim()}`,
    emailStr ? `דוא"ל: ${emailStr}` : null,
    '',
    method === 'pickup' ? 'איסוף עצמי מהסטודיו ברחובות' : `משלוח אל: ${data.address.trim()}, ${data.city.trim()}${isNonEmptyString(data.zip, 20) ? ', מיקוד ' + data.zip.trim() : ''}`,
    '',
    'פריטים:',
    lines,
    '',
    `סה"כ ביניים: ${fmt(data.subtotal)}`,
    `משלוח: ${fmt(data.shipping)}`,
    `סה"כ לתשלום: ${fmt(data.total)}`,
    '',
    `אמצעי תשלום מועדף: ${data.pay === 'apple' ? 'Apple Pay' : data.pay === 'google' ? 'Google Pay' : 'כרטיס אשראי'}`,
    isNonEmptyString(data.note, 1000) ? `הערה: ${data.note.trim()}` : null,
  ].filter((l) => l !== null).join('\n');

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    res.status(500).json({ error: 'email not configured' });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: `"GAYA — הזמנות" <${process.env.GMAIL_USER}>`,
      to: NOTIFY_TO,
      replyTo: emailStr || undefined,
      subject: `הזמנה חדשה #${orderId} — ${data.name.trim()}`,
      text,
    });
  } catch (err) {
    res.status(502).json({ error: 'email send failed', detail: String(err && err.message || err) });
    return;
  }

  res.status(200).json({ ok: true, orderId });
};
