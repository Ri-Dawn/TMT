// POST /api/webhooks/razorpay
// Razorpay Dashboard > Settings > Webhooks: URL https://www.midnighttruth.com/api/webhooks/razorpay,
// event "payment.captured", secret = RAZORPAY_WEBHOOK_SECRET.
const crypto = require('crypto');
const { supabase } = require('../../lib/supabase');
const { sendMail, liveEmail, writtenEmail } = require('../../lib/mail');

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function notifyOwner(subject, text) {
  if (process.env.OWNER_EMAIL) await sendMail({ to: process.env.OWNER_EMAIL, subject, text, html: '<pre style="font-family:sans-serif">' + text.replace(/</g, '&lt;') + '</pre>' });
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
      if (booking) {
        if (booking.payment_status !== 'paid') {
          await supabase.from('bookings').update({ payment_status: 'paid' }).eq('id', booking.id);
          await supabase.from('slots').update({ status: 'booked', held_until: null }).eq('id', booking.slot_id);
          try {
            const { data: slot } = await supabase.from('slots').select('*').eq('id', booking.slot_id).single();
            const { data: rt } = await supabase.from('reading_types').select('*').eq('id', booking.reading_type_id).single();
            if (slot && rt) {
              const sent = await sendMail(liveEmail({ booking, slot, rt }));
              if (sent) await supabase.from('bookings').update({ email_sent: true }).eq('id', booking.id);
              await notifyOwner(`New booking · ${rt.label} · ${booking.booking_code}`, `${booking.client_name}\n${booking.client_email} · ${booking.client_phone}\n${rt.label}, ${slot.slot_date} ${slot.start_time} IST\nSpeaks via: ${booking.contact_mode}\nReference: ${booking.booking_code}`);
            }
          } catch (mailErr) { console.error('Booking email error:', mailErr); }
        }
      } else {
        const { data: order } = await supabase.from('written_orders').select('*').eq('payment_ref', orderId).single();
        if (order && order.payment_status !== 'paid') {
          await supabase.from('written_orders').update({ payment_status: 'paid', due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() }).eq('id', order.id);
          try {
            const { data: rt } = await supabase.from('reading_types').select('*').eq('id', order.reading_type_id).single();
            const fresh = { ...order, due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
            if (rt) {
              const sent = await sendMail(writtenEmail({ order: fresh, rt }));
              if (sent) await supabase.from('written_orders').update({ email_sent: true }).eq('id', order.id);
              await notifyOwner(`New written reading · ${rt.label} · ${order.order_code}`, `${order.client_name}\nSend by: ${order.delivery_mode || 'email'} · ${order.delivery_mode === 'instagram' ? '@' + order.delivery_contact : (order.delivery_contact || order.client_email)}\n${order.question_text || order.number_text + ' · ' + (order.context_text || '')}\nDue within 24 hours.`);
            }
          } catch (mailErr) { console.error('Written email error:', mailErr); }
        }
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
