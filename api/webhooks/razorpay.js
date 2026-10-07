// POST /api/webhooks/razorpay
// Razorpay Dashboard > Settings > Webhooks: URL https://www.midnighttruth.com/api/webhooks/razorpay,
// event "payment.captured", secret = RAZORPAY_WEBHOOK_SECRET.
const crypto = require('crypto');
const { supabase } = require('../../lib/supabase');

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const raw = await getRawBody(req);
  const sig = String(req.headers['x-razorpay-signature'] || '');
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '').update(raw).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    console.error('Razorpay webhook: signature mismatch');
    return res.status(400).json({ error: 'Invalid signature.' });
  }
  const event = JSON.parse(raw);
  try {
    if (event.event === 'payment.captured') {
      const orderId = event.payload.payment.entity.order_id;
      const { data: booking } = await supabase.from('bookings').select('*').eq('payment_ref', orderId).single();
      if (booking && booking.payment_status !== 'paid') {
        await supabase.from('bookings').update({ payment_status: 'paid' }).eq('id', booking.id);
        await supabase.from('slots').update({ status: 'booked', held_until: null }).eq('id', booking.slot_id);
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Razorpay webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
}
module.exports = handler;
module.exports.config = { api: { bodyParser: false } }; // set AFTER the export, so Vercel keeps it
