const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { appendOrder } = require('./_orders-store');
const { readSubs, removeSubs } = require('./_push-store');

const MAX_BYTES = 20 * 1024;
const NOTIFY_TO = 'giljabes22@gmail.com';

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}
// Strips CR/LF so user-supplied text can't inject extra headers into the
// notification email (name/email feed the Subject and Reply-To headers).
function noHeaderBreak(v) {
  return String(v).replace(/[\r\n]+/g, ' ').trim();
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
  // priceMax is optional: a price-range product sends its low end as price
  // and its high end as priceMax (final price agreed with the customer later).
  // When present it must be a finite number >= price; equal ends are stored
  // as a plain fixed-price item.
  const items = Array.isArray(data.items) ? data.items.filter((it) =>
    it && isNonEmptyString(String(it.id || ''), 40) && isNonEmptyString(String(it.name || ''), 200) &&
    Number.isFinite(it.qty) && it.qty > 0 && Number.isFinite(it.price) && it.price >= 0 &&
    (it.priceMax === undefined || it.priceMax === null || (Number.isFinite(it.priceMax) && it.priceMax >= it.price))
  ).map((it) => {
    const out = Object.assign({}, it);
    if (Number.isFinite(it.priceMax) && it.priceMax > it.price) out.priceMax = it.priceMax;
    else delete out.priceMax;
    return out;
  }) : [];

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
  // LRMs around the dash keep "800–1,200" in reading order inside RTL text.
  const fmtRange = (lo, hi) => hi > lo
    ? `${Number(lo).toLocaleString('he-IL')}\u200E–\u200E${Number(hi).toLocaleString('he-IL')} ₪`
    : fmt(lo);
  // How much higher the order can come out once range items are priced.
  const rangeExtra = items.reduce((t, it) => t + (it.priceMax !== undefined ? (it.priceMax - it.price) * it.qty : 0), 0);
  const lines = items.map((it) => it.priceMax !== undefined
    ? `  ${it.name} × ${it.qty} — ${fmtRange(it.price * it.qty, it.priceMax * it.qty)} (טווח מחיר, ייקבע בתיאום)`
    : `  ${it.name} × ${it.qty} — ${fmt(it.price * it.qty)}`).join('\n');
  const emailStr = isNonEmptyString(data.email, 200) ? noHeaderBreak(data.email) : '';
  const safeName = noHeaderBreak(data.name);
  const text = [
    `הזמנה חדשה מהאתר #${orderId}`,
    '',
    `שם: ${safeName}`,
    `טלפון: ${data.phone.trim()}`,
    emailStr ? `דוא"ל: ${emailStr}` : null,
    '',
    method === 'pickup' ? 'איסוף עצמי מהסטודיו ברחובות' : `משלוח אל: ${data.address.trim()}, ${data.city.trim()}${isNonEmptyString(data.zip, 20) ? ', מיקוד ' + data.zip.trim() : ''}`,
    '',
    'פריטים:',
    lines,
    '',
    rangeExtra > 0 ? `סה"כ ביניים משוער: ${fmtRange(Number(data.subtotal) || 0, (Number(data.subtotal) || 0) + rangeExtra)}` : `סה"כ ביניים: ${fmt(data.subtotal)}`,
    `משלוח: ${fmt(data.shipping)}`,
    rangeExtra > 0 ? `סה"כ משוער לתשלום: ${fmtRange(Number(data.total) || 0, (Number(data.total) || 0) + rangeExtra)}` : `סה"כ לתשלום: ${fmt(data.total)}`,
    rangeExtra > 0 ? 'המחיר הסופי למוצרים בטווח מחיר ייקבע בתיאום עם הלקוח.' : null,
    '',
    `אמצעי תשלום מועדף: ${data.pay === 'apple' ? 'Apple Pay' : data.pay === 'google' ? 'Google Pay' : 'כרטיס אשראי'}`,
    isNonEmptyString(data.note, 1000) ? `הערה: ${data.note.trim()}` : null,
  ].filter((l) => l !== null).join('\n');

  const now = new Date();
  const storedOrder = {
    ref: orderId,
    date: now.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jerusalem' }),
    createdAt: now.toISOString(),
    customer: safeName,
    phone: data.phone.trim(),
    email: emailStr,
    method: method === 'pickup' ? 'איסוף' : 'משלוח',
    address: method === 'pickup' ? 'איסוף מהסטודיו ברחובות' : `${data.address.trim()}, ${data.city.trim()}${isNonEmptyString(data.zip, 20) ? ', מיקוד ' + data.zip.trim() : ''}`,
    pay: data.pay === 'apple' ? 'Apple Pay' : data.pay === 'google' ? 'Google Pay' : 'כרטיס אשראי',
    note: isNonEmptyString(data.note, 1000) ? data.note.trim() : '',
    items,
    subtotal: Number(data.subtotal) || 0,
    shipping: Number(data.shipping) || 0,
    total: Number(data.total) || 0,
    state: 'new',
  };

  // Persisting is the durable record — do it before the email so the order
  // is never lost even if Gmail is slow, down, or misconfigured. If the store
  // itself is down (e.g. suspended for hitting plan limits) the email becomes
  // the only record, so carry on and send it rather than turn the customer away.
  let saved = true;
  try {
    await appendOrder(storedOrder);
  } catch (err) {
    saved = false;
    console.error('order save failed', orderId, err);
  }

  // Push is a best-effort second channel — the order is already saved, so a
  // push failure (or nobody subscribed yet) must never fail the request.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails('mailto:giljabes22@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      const { subs } = await readSubs();
      const payload = JSON.stringify({
        title: 'הזמנה חדשה ב-GAYA',
        body: `${safeName} · ${fmtRange(storedOrder.total, storedOrder.total + rangeExtra)}`,
        url: '/admin/orders/' + orderId,
      });
      const dead = [];
      await Promise.all(subs.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, payload);
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(sub.endpoint);
        }
      }));
      if (dead.length) await removeSubs(dead).catch(() => {});
    } catch (err) {
      // ignore — push is best-effort
    }
  }

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
      subject: `הזמנה חדשה #${orderId} — ${safeName}`,
      text: saved ? text : text + '\n\n⚠️ ההזמנה לא נשמרה בפאנל הניהול (האחסון לא זמין) — המייל הזה הוא הרישום היחיד שלה.',
    });
  } catch (err) {
    if (!saved) {
      // Neither the store nor email took it — the order exists nowhere, so
      // the customer must be told it did not go through.
      res.status(500).json({ error: 'save failed', detail: String(err && err.message || err) });
      return;
    }
    // The order is already saved and visible in the admin panel even though
    // email failed — but we still report an error so a broken mail config
    // doesn't silently go unnoticed.
    res.status(502).json({ error: 'email send failed', detail: String(err && err.message || err) });
    return;
  }

  res.status(200).json({ ok: true, orderId });
};
