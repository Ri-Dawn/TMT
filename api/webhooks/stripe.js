// POST /api/webhooks/stripe
// Configure this URL in Stripe Dashboard > Developers > Webhooks, subscribed to
// the "checkout.session.completed" event.
const Stripe = require('stripe');
const { supabase } = require('../../lib/supabase');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe also needs the raw body to verify its signature.
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
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook: signature verification failed', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;

      const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
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
    console.error('Stripe webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
