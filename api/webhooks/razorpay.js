// POST /api/webhooks/razorpay
// Configure this URL in Razorpay Dashboard > Settings > Webhooks, subscribed to
// the "payment.captured" event, with the same secret as RAZORPAY_WEBHOOK_SECRET below.
const crypto = require('crypto');
const { supabase } = require('../../lib/supabase');

// Vercel needs the raw body to verify the signature — turn off automatic JSON parsing.
module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-razorpay-signature'];

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error('Razorpay webhook: signature mismatch');
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  const event = JSON.parse(rawBody);

  try {
    if (event.event === 'payment.captured') {
      const orderId = event.payload.payment.entity.order_id;

      const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('payment_ref', orderId)
        .single();

      if (booking && booking.payment_status !== 'paid') {
        await supabase.from('bookings').update({ payment_status: 'paid' }).eq('id', booking.id);
        await supabase.from('slots').update({ status: 'booked', held_until: null }).eq('id', booking.slot_id);
        // Phase 2 will hook in here: create the Google Meet event and send the
        // confirmation email/SMS. For now the booking is simply marked paid.
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Razorpay webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
